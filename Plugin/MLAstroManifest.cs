using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.ComponentModel.Composition;
using System.IO;
using System.Linq; 
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using MLAstro_Robotic_Polar_Alignment.Dockables;
using MLAstro_Robotic_Polar_Alignment.Services;
using MLAstro_Robotic_Polar_Alignment.Settings;
using NINA.Core.Utility;
using NINA.Core.Utility.Notification;
using NINA.Plugin;
using NINA.Plugin.Interfaces;
 
namespace MLAstro_Robotic_Polar_Alignment.Plugin
{

    [Export(typeof(IPluginManifest))]
    public class MLAstroManifest : PluginBase, INotifyPropertyChanged, IDisposable
    {
        private static readonly int[] DefaultBaudRates = { 9600, 19200, 38400, 57600, 115200, 230400 };

        private readonly SerialConnectionService _serialConnectionService;
        private ResourceDictionary _pluginResourceDictionary;
        private FileSystemWatcher _pluginFolderWatcher;
        private bool _disposed = false;
        private bool _isHexInputEnabled;
        private string _serialTerminalInput;
        private bool _isModifyMode;
        private string _autoReconnectStatus = string.Empty;
        private bool _isHandshakeSuccessful;
        private string _savedSettingsSnapshot;

        public PluginSettings Settings { get; }

        public PolarAlignmentDataSourceMode[] AvailableDataSourceModes { get; } = Enum.GetValues<PolarAlignmentDataSourceMode>();

        public event PropertyChangedEventHandler PropertyChanged;

        public string[] AvailableComPorts => string.IsNullOrWhiteSpace(Settings.ComPort)
            ? _serialConnectionService.AvailablePorts
            : _serialConnectionService.AvailablePorts.Contains(Settings.ComPort, StringComparer.OrdinalIgnoreCase)
                ? _serialConnectionService.AvailablePorts
                : _serialConnectionService.AvailablePorts.Concat(new[] { Settings.ComPort }).ToArray();

        public int[] AvailableBaudRates => DefaultBaudRates;

        public string SerialConnectionStatus => _serialConnectionService.ConnectionStatus;

        public string SerialHandshakeStatus => _serialConnectionService.HandshakeStatus;

        public bool IsSerialConnected => _serialConnectionService.IsConnected;

        public string SerialConnectButtonText => IsSerialConnected ? "Disconnect" : "Connect";

        public bool IsHexDisplay
        {
            get => _serialConnectionService.HexDisplay;
            set
            {
                if (_serialConnectionService.HexDisplay != value)
                {
                    _serialConnectionService.HexDisplay = value;
                    OnPropertyChanged();
                }
            }
        }

        public ObservableCollection<SerialTerminalEntry> SerialTerminalEntries => _serialConnectionService.TerminalEntries;

        public bool IsHexInputEnabled
        {
            get => _isHexInputEnabled;
            set
            {
                if (_isHexInputEnabled != value)
                {
                    _isHexInputEnabled = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(SerialInputMaxLength));
                }
            }
        }

        public int SerialInputMaxLength => IsHexInputEnabled ? 16 : 0;

        public string SerialTerminalInput
        {
            get => _serialTerminalInput;
            set
            {
                if (_serialTerminalInput != value)
                {
                    _serialTerminalInput = value;
                    OnPropertyChanged();
                }
            }
        }

        public bool IsModifyMode
        {
            get => _isModifyMode;
            set
            {
                if (_isModifyMode != value)
                {
                    var wasModifyMode = _isModifyMode;
                    _isModifyMode = value;
                    _serialConnectionService.PauseTelemetryUpdates = value;
                    OnPropertyChanged();

                    if (value)
                    {
                        // Entering modify mode - save current settings snapshot
                        _savedSettingsSnapshot = _serialConnectionService.BuildConfigurationCommand(Settings);
                        Logger.Info("[MLAstro] Entering modify mode - settings snapshot saved");
                    }
                    else if (wasModifyMode)
                    {
                        // Exiting modify mode - check if settings changed
                        var currentSettings = _serialConnectionService.BuildConfigurationCommand(Settings);
                        if (currentSettings != _savedSettingsSnapshot)
                        {
                            Logger.Info("[MLAstro] Settings changed - saving to device");
                            SaveAllSettingsInternal();
                        }
                        else
                        {
                            Logger.Info("[MLAstro] No settings changed - skipping save");
                        }
                        _savedSettingsSnapshot = null;
                    }
                }
            }
        }

        public bool IsPauseQuery
        {
            get => SerialConnectionService.PauseQueryGlobal;
            set
            {
                if (SerialConnectionService.PauseQueryGlobal != value)
                {
                    SerialConnectionService.PauseQueryGlobal = value;
                    OnPropertyChanged();
                }
            }
        }

        public string AutoReconnectStatus
        {
            get => _autoReconnectStatus;
            set
            {
                if (_autoReconnectStatus != value)
                {
                    _autoReconnectStatus = value;
                    OnPropertyChanged();
                }
            }
        }

        public bool IsHandshakeSuccessful
        {
            get => _isHandshakeSuccessful;
            set
            {
                if (_isHandshakeSuccessful != value)
                {
                    _isHandshakeSuccessful = value;
                    OnPropertyChanged();
                }
            }
        }

        public ICommand RefreshComPortsCommand { get; }

        public ICommand ToggleSerialConnectionCommand { get; }

        public ICommand SendSerialCommand { get; }

        public ICommand ClearSerialTerminalCommand { get; }

        public ICommand SaveAllSettingsCommand { get; }

        [ImportingConstructor]
        public MLAstroManifest(PluginSettings settings, SerialConnectionService serialConnectionService)
        {
            Settings = settings;
            _serialConnectionService = serialConnectionService;

            RefreshComPortsCommand = new RelayCommand(RefreshComPorts);
            ToggleSerialConnectionCommand = new RelayCommand(ToggleSerialConnection);
            SendSerialCommand = new RelayCommand(SendSerial);
            ClearSerialTerminalCommand = new RelayCommand(ClearSerialTerminal);
            SaveAllSettingsCommand = new RelayCommand(SaveAllSettings);

            Settings.PropertyChanged += OnSettingsPropertyChanged;
            _serialConnectionService.PropertyChanged += OnSerialConnectionServicePropertyChanged;
            RefreshComPorts();

            // Hook into application exit to ensure cleanup
            if (Application.Current != null)
            {
                Application.Current.Exit += OnApplicationExit;
            }

            // Setup FileSystemWatcher to detect when plugin is being uninstalled
            // NINA moves plugin folder to DeletionFolder when user clicks Uninstall
            SetupPluginFolderWatcher();

            try
            {
                if (Application.Current != null)
                {
                    _pluginResourceDictionary = new ResourceDictionary
                    {
                        Source = new Uri("pack://application:,,,/MLAstro_Robotic_Polar_Alignment;component/Dockview/Dockable.xaml", UriKind.Absolute)
                    };
                    Application.Current.Resources.MergedDictionaries.Add(_pluginResourceDictionary);
                }

                var iconLocatorType = AppDomain.CurrentDomain.GetAssemblies()
                    .SelectMany(a => {
                        try { return a.GetTypes(); } catch { return Type.EmptyTypes; }
                    })
                    .FirstOrDefault(t => t.Name == "IconLocator");

                if (iconLocatorType != null)
                {
                    var registerMethod = iconLocatorType.GetMethod("Register", new[] { typeof(Uri) });
                    if (registerMethod != null)
                    {
                        var uri = new Uri("pack://application:,,,/MLAstro_Robotic_Polar_Alignment;component/Resources/MLAstroIcons.xaml", UriKind.Absolute);
                        registerMethod.Invoke(null, new object[] { uri });
                    }
                }
            }
            catch { }
        }

        private void OnApplicationExit(object sender, ExitEventArgs e)
        {
            Logger.Info("[MLAstro] Application exiting, disposing plugin resources...");
            Dispose();
        }

        /// <summary>
        /// Setup a FileSystemWatcher to detect when our plugin folder is being moved/deleted.
        /// NINA moves plugin folder to DeletionFolder when user clicks Uninstall.
        /// This allows us to close the dockable before the uninstall completes.
        /// </summary>
        private void SetupPluginFolderWatcher()
        {
            try
            {
                // Get the plugin assembly's directory
                // Plugin is at: %LOCALAPPDATA%\NINA\Plugins\3.0.0\MLAstro_Robotic_Polar_Alignment
                var assemblyLocation = GetType().Assembly.Location;
                var pluginFolder = Path.GetDirectoryName(assemblyLocation);

                Logger.Info($"[MLAstro] Plugin assembly location: {assemblyLocation}");
                Logger.Info($"[MLAstro] Plugin folder: {pluginFolder}");

                // Only watch OUR plugin folder for file deletions
                // This ensures we only trigger when MLAstro RPA plugin is being uninstalled
                // NOT when other plugins are installed/uninstalled
                if (!string.IsNullOrEmpty(pluginFolder) && Directory.Exists(pluginFolder))
                {
                    // Use a flag to only trigger notification once
                    bool pluginFolderNotificationShown = false;

                    _pluginFolderWatcher = new FileSystemWatcher(pluginFolder)
                    {
                        NotifyFilter = NotifyFilters.FileName,
                        Filter = "*.dll",
                        IncludeSubdirectories = false,
                        EnableRaisingEvents = true
                    };

                    _pluginFolderWatcher.Deleted += (s, e) =>
                    {
                        Logger.Info($"[MLAstro] File deleted/moved from plugin folder: {e.Name}");
                        // Only trigger on OUR plugin's DLL deletion
                        if (e.Name?.Contains("MLAstro", StringComparison.OrdinalIgnoreCase) == true ||
                            e.Name?.Equals("System.IO.Ports.dll", StringComparison.OrdinalIgnoreCase) == true)
                        {
                            if (!pluginFolderNotificationShown)
                            {
                                pluginFolderNotificationShown = true;
                                Logger.Info($"[MLAstro] MLAstro plugin DLL moved: {e.Name} - triggering uninstall cleanup");
                                OnPluginUninstalling();
                            }
                        }
                    };

                    Logger.Info("[MLAstro] Plugin folder watcher setup complete");
                }
                else
                {
                    Logger.Warning("[MLAstro] Plugin folder not found - cannot setup watcher");
                }
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Failed to setup plugin folder watcher: {ex.Message}");
            }
        }

        /// <summary>
        /// Called when the plugin is being uninstalled (folder moved to DeletionFolder).
        /// Shows a notification to user that NINA restart is required.
        /// </summary>
        private void OnPluginUninstalling()
        {
            try
            {
                Logger.Info("[MLAstro] Plugin uninstalling detected");

                // Show notification to user - specific to MLAstro RPA plugin
                Notification.ShowWarning(
                    "MLAstro RPA: Plugin is being uninstalled. Please RESTART NINA to complete the removal and close the control panel.",
                    TimeSpan.FromMinutes(5));

                // Must run on UI thread
                Application.Current?.Dispatcher?.Invoke(() =>
                {
                    try
                    {
                        var dockableVM = PolarAlignmentDockVM.Instance;
                        if (dockableVM != null)
                        {
                            Logger.Info("[MLAstro] Closing dockable panel...");
                            dockableVM.IsVisible = false;
                            dockableVM.IsClosed = true;
                            dockableVM.Dispose();
                            Logger.Info("[MLAstro] Dockable panel closed successfully");
                        }

                        // Disconnect serial
                        if (_serialConnectionService?.IsConnected == true)
                        {
                            _serialConnectionService.Disconnect();
                        }
                    }
                    catch (Exception ex)
                    {
                        Logger.Warning($"[MLAstro] Error closing dockable on uninstall: {ex.Message}");
                    }
                });

                // Try to delete the plugin folder after a short delay (allow NINA to finish moving files)
                Task.Run(async () =>
                {
                    try
                    {
                        // Wait for NINA to finish moving files
                        await Task.Delay(2000);

                        var assemblyLocation = GetType().Assembly.Location;
                        var pluginFolder = Path.GetDirectoryName(assemblyLocation);

                        if (!string.IsNullOrEmpty(pluginFolder) && Directory.Exists(pluginFolder))
                        {
                            Logger.Info($"[MLAstro] Attempting to delete plugin folder: {pluginFolder}");

                            // Try to delete remaining files first
                            foreach (var file in Directory.GetFiles(pluginFolder, "*.*", SearchOption.AllDirectories))
                            {
                                try
                                {
                                    File.Delete(file);
                                    Logger.Info($"[MLAstro] Deleted file: {file}");
                                }
                                catch (Exception ex)
                                {
                                    Logger.Warning($"[MLAstro] Could not delete file {file}: {ex.Message}");
                                }
                            }

                            // Try to delete empty subdirectories
                            foreach (var dir in Directory.GetDirectories(pluginFolder, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length))
                            {
                                try
                                {
                                    if (!Directory.EnumerateFileSystemEntries(dir).Any())
                                    {
                                        Directory.Delete(dir);
                                        Logger.Info($"[MLAstro] Deleted empty directory: {dir}");
                                    }
                                }
                                catch (Exception ex)
                                {
                                    Logger.Warning($"[MLAstro] Could not delete directory {dir}: {ex.Message}");
                                }
                            }

                            // Try to delete the plugin folder itself
                            try
                            {
                                if (!Directory.EnumerateFileSystemEntries(pluginFolder).Any())
                                {
                                    Directory.Delete(pluginFolder);
                                    Logger.Info($"[MLAstro] Plugin folder deleted successfully");
                                }
                                else
                                {
                                    Logger.Info($"[MLAstro] Plugin folder not empty, will be cleaned up on NINA restart");
                                }
                            }
                            catch (Exception ex)
                            {
                                Logger.Warning($"[MLAstro] Could not delete plugin folder: {ex.Message}");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Logger.Warning($"[MLAstro] Error during plugin folder cleanup: {ex.Message}");
                    }
                });
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Error in OnPluginUninstalling: {ex.Message}");
            }
        }

        private void RefreshComPorts()
        {
            _serialConnectionService.RefreshPorts();
            OnPropertyChanged(nameof(AvailableComPorts));
        }

        private void ToggleSerialConnection()
        {
            if (IsSerialConnected)
            {
                _serialConnectionService.Disconnect();
                return;
            }

            RefreshComPorts();
            _serialConnectionService.Connect(Settings.ComPort, Settings.BaudRate);
        }

        private void SendSerial()
        {
            var input = SerialTerminalInput;
            var sent = IsHexInputEnabled
                ? _serialConnectionService.SendHex(input)
                : _serialConnectionService.Send(input.EndsWith('\n') ? input : input + "\n");

            if (sent)
            {
                SerialTerminalInput = string.Empty;
            }
        }

        private void ClearSerialTerminal()
        {
            _serialConnectionService.ClearTerminal();
        }

        private async void SaveAllSettingsInternal()
        {
            if (!IsSerialConnected)
            {
                return;
            }

            try
            {
                // Build configuration command string
                var configCommand = _serialConnectionService.BuildConfigurationCommand(Settings);

                // Send to device
                var sent = _serialConnectionService.Send(configCommand);
                if (!sent)
                {
                    Logger.Warning("[MLAstro] Failed to send configuration command");
                    return;
                }

                // Wait for device to process and reboot
                await System.Threading.Tasks.Task.Delay(1000);

                // Disconnect
                _serialConnectionService.Disconnect();

                // Start countdown and auto-reconnect
                await AutoReconnectAsync();
            }
            catch (Exception ex)
            {
                Logger.Error($"[MLAstro] Save settings failed: {ex.Message}");
            }
        }

        private void SaveAllSettings()
        {
            // This is now handled by IsModifyMode property setter
            // Keep for backward compatibility with command binding
            if (IsModifyMode)
            {
                IsModifyMode = false; // This will trigger SaveAllSettingsInternal
            }
        }

        private async System.Threading.Tasks.Task AutoReconnectAsync()
        {
            try
            {
                // Countdown 5 seconds
                for (int i = 5; i > 0; i--)
                {
                    AutoReconnectStatus = $"Reconnecting in {i}s...";
                    await System.Threading.Tasks.Task.Delay(1000);
                }

                AutoReconnectStatus = "Connecting...";

                // Try to reconnect
                RefreshComPorts();
                var connected = _serialConnectionService.Connect(Settings.ComPort, Settings.BaudRate);

                if (connected)
                {
                    // Wait up to 3 seconds for handshake
                    var handshakeSuccess = false;
                    for (int i = 0; i < 30; i++) // 30 x 100ms = 3s
                    {
                        await System.Threading.Tasks.Task.Delay(100);
                        if (_serialConnectionService.HandshakeStatus == "OK!")
                        {
                            handshakeSuccess = true;
                            break;
                        }
                    }

                    if (handshakeSuccess)
                    {
                        AutoReconnectStatus = "Connected";
                        await System.Threading.Tasks.Task.Delay(2000);
                        AutoReconnectStatus = string.Empty;
                    }
                    else
                    {
                        AutoReconnectStatus = "Handshake timeout";
                        ShowConnectionError();
                    }
                }
                else
                {
                    AutoReconnectStatus = "Connection failed";
                    ShowConnectionError();
                }
            }
            catch (Exception ex)
            {
                Logger.Error($"[MLAstro] Auto reconnect failed: {ex.Message}");
                AutoReconnectStatus = "Error";
                ShowConnectionError();
            }
        }

        private void ShowConnectionError()
        {
            try
            {
                if (Application.Current?.Dispatcher != null)
                {
                    Application.Current.Dispatcher.Invoke(() =>
                    {
                        MessageBox.Show(
                            "CANNOT CONNECTED TO MLAstroRPA HARDWARE",
                            "Connection Error",
                            MessageBoxButton.OK,
                            MessageBoxImage.Error);

                        AutoReconnectStatus = string.Empty;
                    });
                }
            }
            catch (Exception ex)
            {
                Logger.Error($"[MLAstro] Failed to show error dialog: {ex.Message}");
            }
        }

        private void OnSettingsPropertyChanged(object sender, PropertyChangedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.PropertyName) || e.PropertyName == nameof(PluginSettings.ComPort))
            {
                OnPropertyChanged(nameof(AvailableComPorts));
            }
        }

        private void OnSerialConnectionServicePropertyChanged(object sender, PropertyChangedEventArgs e)
        {
            if (string.IsNullOrEmpty(e.PropertyName)
                || e.PropertyName == nameof(SerialConnectionService.AvailablePorts))
            {
                OnPropertyChanged(nameof(AvailableComPorts));
            }

            if (string.IsNullOrEmpty(e.PropertyName)
                || e.PropertyName == nameof(SerialConnectionService.ConnectionStatus))
            {
                OnPropertyChanged(nameof(SerialConnectionStatus));
            }

            if (string.IsNullOrEmpty(e.PropertyName)
                || e.PropertyName == nameof(SerialConnectionService.HandshakeStatus))
            {
                OnPropertyChanged(nameof(SerialHandshakeStatus));

                // Update IsHandshakeSuccessful based on HandshakeStatus
                var isSuccess = _serialConnectionService.HandshakeStatus == "OK!";
                IsHandshakeSuccessful = isSuccess;

                // Reset IsModifyMode when handshake fails
                if (!isSuccess && IsModifyMode)
                {
                    Logger.Info("[MLAstro] Handshake failed - resetting modify mode");
                    _isModifyMode = false; // Direct set to avoid triggering save
                    _serialConnectionService.PauseTelemetryUpdates = false;
                    _savedSettingsSnapshot = null;
                    OnPropertyChanged(nameof(IsModifyMode));
                }
            }

            if (string.IsNullOrEmpty(e.PropertyName)
                || e.PropertyName == nameof(SerialConnectionService.IsConnected))
            {
                OnPropertyChanged(nameof(IsSerialConnected));
                OnPropertyChanged(nameof(SerialConnectButtonText));

                // Reset states when disconnected
                if (!_serialConnectionService.IsConnected)
                {
                    IsHandshakeSuccessful = false;

                    // Reset IsModifyMode when disconnected
                    if (IsModifyMode)
                    {
                        Logger.Info("[MLAstro] Disconnected - resetting modify mode");
                        _isModifyMode = false; // Direct set to avoid triggering save
                        _serialConnectionService.PauseTelemetryUpdates = false;
                        _savedSettingsSnapshot = null;
                        OnPropertyChanged(nameof(IsModifyMode));
                    }
                }
            }

            if (string.IsNullOrEmpty(e.PropertyName)
                || e.PropertyName == nameof(SerialConnectionService.HexDisplay))
            {
                OnPropertyChanged(nameof(IsHexDisplay));
            }
        }

        private void OnPropertyChanged([CallerMemberName] string propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }

        /// <summary>
        /// Called by NINA when the plugin is being unloaded/disabled.
        /// This is the main cleanup hook for NINA plugins.
        /// Overrides PluginBase.Teardown() which is virtual.
        /// </summary>
        public override Task Teardown() 
        {
            Logger.Info("[MLAstro] Plugin Teardown called by NINA");
            Dispose();
            return Task.CompletedTask;
        }

        #region IDisposable

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (_disposed)
            {
                return;
            }

            if (disposing)
            {
                Logger.Info("[MLAstro] MLAstroManifest disposing...");

                // Close dockable window first using static instance
                try
                {
                    var dockableVM = PolarAlignmentDockVM.Instance;
                    Logger.Info($"[MLAstro] PolarAlignmentDockVM.Instance is {(dockableVM != null ? "not null (hash: " + dockableVM.GetHashCode() + ")" : "NULL")}");

                    if (dockableVM != null)
                    {
                        Logger.Info("[MLAstro] Closing dockable - setting IsVisible=false, IsClosed=true");
                        // Hide the dockable first
                        dockableVM.IsVisible = false;
                        // Then mark it as closed
                        dockableVM.IsClosed = true;
                        // Dispose resources
                        dockableVM.Dispose();
                        Logger.Info("[MLAstro] Dockable VM hidden, closed and disposed");
                    }
                    else
                    {
                        Logger.Warning("[MLAstro] PolarAlignmentDockVM.Instance is null - cannot close dockable");
                    }
                }
                catch (Exception ex)
                {
                    Logger.Warning($"[MLAstro] Failed to close dockable: {ex.Message}");
                }

                // Remove ResourceDictionary from Application to release assembly reference
                try
                {
                    if (Application.Current != null && _pluginResourceDictionary != null)
                    {
                        Application.Current.Resources.MergedDictionaries.Remove(_pluginResourceDictionary);
                        _pluginResourceDictionary = null;
                        Logger.Info("[MLAstro] ResourceDictionary removed from Application");
                    }
                }
                catch (Exception ex)
                {
                    Logger.Warning($"[MLAstro] Failed to remove ResourceDictionary: {ex.Message}");
                }

                // Unsubscribe from application exit event
                if (Application.Current != null)
                {
                    Application.Current.Exit -= OnApplicationExit;
                }

                // Dispose FileSystemWatcher
                if (_pluginFolderWatcher != null)
                {
                    _pluginFolderWatcher.EnableRaisingEvents = false;
                    _pluginFolderWatcher.Dispose();
                    _pluginFolderWatcher = null;
                    Logger.Info("[MLAstro] Plugin folder watcher disposed");
                }

                // Unsubscribe from settings events
                if (Settings != null)
                {
                    Settings.PropertyChanged -= OnSettingsPropertyChanged;
                }

                // Unsubscribe from serial connection service events
                if (_serialConnectionService != null)
                {
                    _serialConnectionService.PropertyChanged -= OnSerialConnectionServicePropertyChanged;

                    // Disconnect and dispose serial service
                    _serialConnectionService.Disconnect();
                    _serialConnectionService.Dispose();
                }

                // Clear static singleton instances to allow GC
                PluginSettings.ClearInstance();

                Logger.Info("[MLAstro] MLAstroManifest disposed");
            }

            _disposed = true;
        }
         
        ~MLAstroManifest()
        {
            Dispose(false);
        }

        #endregion

        private class RelayCommand : ICommand
        {
            private readonly Action _execute;

            public RelayCommand(Action execute)
            {
                _execute = execute;
            }

            public bool CanExecute(object parameter) => true;

            public event EventHandler CanExecuteChanged;

            public void Execute(object parameter) => _execute();
        }

    }

}