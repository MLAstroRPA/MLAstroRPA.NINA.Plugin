using NINA.Equipment.Interfaces.ViewModel;
using NINA.Profile.Interfaces;
using NINA.WPF.Base.ViewModel;
using NINA.Core.Utility;
using System;
using System.ComponentModel;
using System.ComponentModel.Composition;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using MLAstro_Robotic_Polar_Alignment.Settings;
using MLAstro_Robotic_Polar_Alignment.Services;

namespace MLAstro_Robotic_Polar_Alignment.Dockables
{ 
    [Export(typeof(IDockableVM))]
    [PartCreationPolicy(CreationPolicy.Shared)]
    public class PolarAlignmentDockVM : DockableVM, IDisposable
    { 
        private readonly PluginSettings _settings;
        private readonly SerialConnectionService _serialService;
        private System.Timers.Timer _jogWatchdogTimer;
        private string _currentJogCommand = null;
        private bool _disposed = false;

        // Static instance for cleanup during plugin teardown
        private static PolarAlignmentDockVM _instance;
        private static readonly object _instanceLock = new();

        /// <summary>
        /// Gets the current instance of PolarAlignmentDockVM for cleanup purposes.
        /// </summary>
        public static PolarAlignmentDockVM Instance => _instance;

        // Header Properties
        private string _firmwareVersion = "unknown";
        private string _spiffsVersion = "1.0.118";
        private string _systemStatus = "Idle";
        private Brush _statusForeground = Brushes.White;
        private Brush _connectionStatusColor = Brushes.Gray;
        private string _connectionStatusText = "Disconnected";
        private Visibility _controlsVisibility = Visibility.Collapsed;

        // Manual Movement Properties
        private int _currentSpeed = 3;
        private bool _isRelativeMode = false;
        private Visibility _relativeOptionsVisibility = Visibility.Collapsed;
        private int _relativeDegrees = 0;
        private int _relativeMinutes = 0;
        private int _relativeSeconds = 1;

        // Position Properties
        private string _azPosition = "+0° 00' 00\"";
        private string _altPosition = "+0° 00' 00\"";
        private string _azSteps = "0";
        private string _altSteps = "0";
        private string _azOutSpeed = "0.000";
        private string _altOutSpeed = "0.000";
        private string _azMotorSpeed = "0.000";
        private string _altMotorSpeed = "0.000";
        private string _homedStatus = "No";

        // Alignment Properties
        private int _azErrorDeg = 0;
        private int _azErrorMin = 0;
        private int _azErrorSec = 0;
        private bool _azErrorRight = false;
        private int _altErrorDeg = 0;
        private int _altErrorMin = 0;
        private int _altErrorSec = 0;
        private bool _altErrorUp = false;

        // Flag to track if we're syncing from telemetry (prevents sending command back to hardware)
        private bool _isSyncingFromTelemetry = false;

        // Flag to enable/disable alignment input editing (when ON: user can edit, telemetry sync paused)
        private bool _isAlignmentModifyMode = false;

        // Flag for automated adjustment mode (disables manual controls and telemetry sync)
        private bool _isAutomatedAdjustment = false;

        // Flag to pause telemetry sync for relative values when user is editing
        private bool _isEditingRelativeValues = false;

        public override string ContentId => "MLAstro_Robotic_Polar_Alignment";

        #region Header Properties

        public string FirmwareVersion
        {
            get => _firmwareVersion;
            set => SetProperty(ref _firmwareVersion, value);
        }

        public string SpiffsVersion
        {
            get => _spiffsVersion;
            set => SetProperty(ref _spiffsVersion, value);
        }

        public string SystemStatus
        {
            get => _systemStatus;
            set
            {
                if (SetProperty(ref _systemStatus, value))
                {
                    UpdateStatusColor();
                }
            }
        }

        public Brush StatusForeground
        {
            get => _statusForeground;
            private set => SetProperty(ref _statusForeground, value);
        }

        public Brush ConnectionStatusColor
        {
            get => _connectionStatusColor;
            private set => SetProperty(ref _connectionStatusColor, value);
        }

        public string ConnectionStatusText
        {
            get => _connectionStatusText;
            set => SetProperty(ref _connectionStatusText, value);
        }

        public Visibility ControlsVisibility
        {
            get => _controlsVisibility;
            private set => SetProperty(ref _controlsVisibility, value);
        }

        #endregion

        #region Manual Movement Properties

        public int CurrentSpeed
        {
            get => _currentSpeed;
            set => SetProperty(ref _currentSpeed, value);
        }

        public bool IsRelativeMode
        {
            get => _isRelativeMode;
            set
            {
                if (SetProperty(ref _isRelativeMode, value))
                {
                    RelativeOptionsVisibility = value ? Visibility.Visible : Visibility.Collapsed;

                    // Send mode switch command
                    SendCommand($"JoRe:{(value ? 1 : 0)}\n");
                }
            }
        }

        public Visibility RelativeOptionsVisibility
        {
            get => _relativeOptionsVisibility;
            private set => SetProperty(ref _relativeOptionsVisibility, value);
        }

        public int RelativeDegrees
        {
            get => _relativeDegrees;
            set => SetProperty(ref _relativeDegrees, Math.Max(0, Math.Min(2, value)));
        }

        public int RelativeMinutes
        {
            get => _relativeMinutes;
            set => SetProperty(ref _relativeMinutes, Math.Max(0, Math.Min(60, value)));
        }

        public int RelativeSeconds
        {
            get => _relativeSeconds;
            set => SetProperty(ref _relativeSeconds, Math.Max(0, Math.Min(60, value)));
        }

        /// <summary>
        /// Start editing relative values - pause telemetry sync
        /// </summary>
        public void StartEditingRelative()
        {
            _isEditingRelativeValues = true;
        }

        /// <summary>
        /// Send relative degrees to hardware immediately
        /// </summary>
        public void SendRelativeDegrees()
        {
            _isEditingRelativeValues = false;
            SendCommand($"ReDe:{_relativeDegrees}\n");
            Logger.Info($"[MLAstro] Sent ReDe:{_relativeDegrees}");
        }

        /// <summary>
        /// Send relative minutes to hardware immediately
        /// </summary>
        public void SendRelativeMinutes()
        {
            _isEditingRelativeValues = false;
            SendCommand($"ReAM:{_relativeMinutes}\n");
            Logger.Info($"[MLAstro] Sent ReAM:{_relativeMinutes}");
        }

        /// <summary>
        /// Send relative seconds to hardware immediately
        /// </summary>
        public void SendRelativeSeconds()
        {
            _isEditingRelativeValues = false;
            SendCommand($"ReAS:{_relativeSeconds}\n");
            Logger.Info($"[MLAstro] Sent ReAS:{_relativeSeconds}");
        }

        #endregion

        #region Position Properties

        public string AzPosition
        {
            get => _azPosition;
            set => SetProperty(ref _azPosition, value);
        }

        public string AltPosition
        {
            get => _altPosition;
            set => SetProperty(ref _altPosition, value);
        }

        // Moved position (relative to alignment start)
        private string _azMovedPosition = "+0° 00' 00\"";
        private string _altMovedPosition = "+0° 00' 00\"";

        public string AzMovedPosition
        {
            get => _azMovedPosition;
            set => SetProperty(ref _azMovedPosition, value);
        }

        public string AltMovedPosition
        {
            get => _altMovedPosition;
            set => SetProperty(ref _altMovedPosition, value);
        }

        public string AzSteps
        {
            get => _azSteps;
            set => SetProperty(ref _azSteps, value);
        }

        public string AltSteps
        {
            get => _altSteps;
            set => SetProperty(ref _altSteps, value);
        }

        public string AzOutSpeed
        {
            get => _azOutSpeed;
            set => SetProperty(ref _azOutSpeed, value);
        }

        public string AltOutSpeed
        {
            get => _altOutSpeed;
            set => SetProperty(ref _altOutSpeed, value);
        }

        public string AzMotorSpeed
        {
            get => _azMotorSpeed;
            set => SetProperty(ref _azMotorSpeed, value);
        }

        public string AltMotorSpeed
        {
            get => _altMotorSpeed;
            set => SetProperty(ref _altMotorSpeed, value);
        }

        public string HomedStatus
        {
            get => _homedStatus;
            set => SetProperty(ref _homedStatus, value);
        }

        #endregion

        #region Alignment Properties

        public int AzErrorDeg
        {
            get => _azErrorDeg;
            set => SetProperty(ref _azErrorDeg, value);
        }

        public int AzErrorMin
        {
            get => _azErrorMin;
            set => SetProperty(ref _azErrorMin, value);
        }

        public int AzErrorSec
        {
            get => _azErrorSec;
            set => SetProperty(ref _azErrorSec, value);
        }

        public bool AzErrorRight
        {
            get => _azErrorRight;
            set
            {
                if (SetProperty(ref _azErrorRight, value) && !_isSyncingFromTelemetry)
                {
                    // User changed - Send direction command to hardware immediately (1 = Right, 0 = Left)
                    SendCommand($"AzDi:{(value ? 1 : 0)}\n");
                    Logger.Info($"[MLAstro] User changed AzDi direction: {(value ? "Right" : "Left")}");
                }
            }
        }

        public int AltErrorDeg
        {
            get => _altErrorDeg;
            set => SetProperty(ref _altErrorDeg, value);
        }

        public int AltErrorMin
        {
            get => _altErrorMin;
            set => SetProperty(ref _altErrorMin, value);
        }

        public int AltErrorSec
        {
            get => _altErrorSec;
            set => SetProperty(ref _altErrorSec, value);
        }

        public bool AltErrorUp
        {
            get => _altErrorUp;
            set
            {
                if (SetProperty(ref _altErrorUp, value) && !_isSyncingFromTelemetry)
                {
                    // User changed - Send direction command to hardware immediately (1 = Up, 0 = Down)
                    SendCommand($"AlDi:{(value ? 1 : 0)}\n");
                    Logger.Info($"[MLAstro] User changed AlDi direction: {(value ? "Up" : "Down")}");
                }
            }
        }

        /// <summary>
        /// When ON (Modify): User can edit alignment values, telemetry sync is paused for these fields.
        /// When OFF (Done): Inputs are disabled, send all settings to hardware, telemetry updates continuously.
        /// </summary>
        public bool IsAlignmentModifyMode
        {
            get => _isAlignmentModifyMode;
            set
            {
                // Cannot modify when in automated adjustment mode
                if (_isAutomatedAdjustment && value)
                {
                    return;
                }

                var wasModifying = _isAlignmentModifyMode;
                if (SetProperty(ref _isAlignmentModifyMode, value))
                {
                    // When switching from Modify (ON) to Done (OFF), send all alignment settings
                    if (wasModifying && !value)
                    {
                        SendAlignmentSettings();
                    }
                    Logger.Info($"[MLAstro] Alignment modify mode: {(value ? "Modify" : "Done")}");
                }
            }
        }

        /// <summary>
        /// When ON: Disables Modify button and all Align buttons, stops telemetry sync for Polar Alignment.
        /// Used when external automation (e.g., plate solving) is controlling the alignment.
        /// </summary>
        public bool IsAutomatedAdjustment
        {
            get => _isAutomatedAdjustment;
            set
            {
                if (SetProperty(ref _isAutomatedAdjustment, value))
                {
                    // If turning on automated mode, force modify mode off
                    if (value && _isAlignmentModifyMode)
                    {
                        _isAlignmentModifyMode = false;
                        OnPropertyChanged(nameof(IsAlignmentModifyMode));
                    }
                    // Notify CanModify, CanAlign and CanManualControl changed for button enable/disable
                    OnPropertyChanged(nameof(CanModify));
                    OnPropertyChanged(nameof(CanAlign));
                    OnPropertyChanged(nameof(CanManualControl));
                    Logger.Info($"[MLAstro] Automated adjustment mode: {(value ? "ON" : "OFF")}");
                }
            }
        }

        /// <summary>
        /// Returns true if Modify button should be enabled (not in automated mode)
        /// </summary>
        public bool CanModify => !_isAutomatedAdjustment;

        /// <summary>
        /// Returns true if Align buttons should be enabled (not in automated mode)
        /// </summary>
        public bool CanAlign => !_isAutomatedAdjustment;

        /// <summary>
        /// Returns true if manual controls should be enabled (not in automated mode)
        /// Affects: movement buttons, speed level buttons, relative controls, set home, return home
        /// </summary>
        public bool CanManualControl => !_isAutomatedAdjustment;

        /// <summary>
        /// Send all alignment settings to hardware in one command
        /// </summary>
        private void SendAlignmentSettings()
        {
            var azDir = _azErrorRight ? 1 : 0;
            var alDir = _altErrorUp ? 1 : 0;
            var command = $"AzED:{_azErrorDeg},AzEM:{_azErrorMin},AzES:{_azErrorSec},AzDi:{azDir}," +
                          $"AlED:{_altErrorDeg},AlEM:{_altErrorMin},AlES:{_altErrorSec},AlDi:{alDir}\n";
            SendCommand(command);
            Logger.Info($"[MLAstro] Sent alignment settings: {command.TrimEnd()}");
        }

        /// <summary>
        /// Toggle between Modify and Done modes
        /// </summary>
        private void OnToggleModify()
        {
            IsAlignmentModifyMode = !IsAlignmentModifyMode;
        }

        #endregion

        #region Commands

        // Speed Commands
        public ICommand SetSpeedCommand { get; }

        // Relative Step Commands
        public ICommand IncRelativeDegreesCommand { get; }
        public ICommand DecRelativeDegreesCommand { get; }
        public ICommand IncRelativeMinutesCommand { get; }
        public ICommand DecRelativeMinutesCommand { get; }
        public ICommand IncRelativeSecondsCommand { get; }
        public ICommand DecRelativeSecondsCommand { get; }

        // Movement Commands
        public ICommand MoveUpCommand { get; }
        public ICommand MoveDownCommand { get; }
        public ICommand MoveLeftCommand { get; }
        public ICommand MoveRightCommand { get; }
        public ICommand StopCommand { get; }
        public ICommand ForceStopCommand { get; }

        // Home Commands
        public ICommand SetHomeCommand { get; }
        public ICommand ReturnHomeCommand { get; }
        public ICommand ResetHomeCommand { get; }

        // Alignment Commands
        public ICommand AlignAzCommand { get; }
        public ICommand AlignAltCommand { get; }
        public ICommand AlignAllCommand { get; }
        public ICommand ToggleModifyCommand { get; }

        #endregion

        [ImportingConstructor]
        public PolarAlignmentDockVM(IProfileService profileService, PluginSettings settings, SerialConnectionService serialService)
            : base(profileService)
        {
            Title = "MLAstro RPA Control";
            Logger.Info("[MLAstro] PolarAlignmentDockVM created");

            // Register this instance for cleanup during plugin teardown
            lock (_instanceLock)
            {
                _instance = this;
                Logger.Info($"[MLAstro] PolarAlignmentDockVM Instance registered: {this.GetHashCode()}");
            }

            _settings = settings;

            // Use singleton instance to ensure we subscribe to the correct instance
            // MEF creates separate instances for different components, so we must use the singleton
            _serialService = SerialConnectionService.Instance;
            Logger.Info($"[MLAstro] Using singleton SerialConnectionService (injected: {serialService.GetHashCode()}, singleton: {_serialService.GetHashCode()})");

            // Initialize Commands
            SetSpeedCommand = new RelayCommand(OnSetSpeed);

            IncRelativeDegreesCommand = new RelayCommand(_ => RelativeDegrees++);
            DecRelativeDegreesCommand = new RelayCommand(_ => RelativeDegrees--);
            IncRelativeMinutesCommand = new RelayCommand(_ => RelativeMinutes += 5);
            DecRelativeMinutesCommand = new RelayCommand(_ => RelativeMinutes -= 5);
            IncRelativeSecondsCommand = new RelayCommand(_ => RelativeSeconds += 5);
            DecRelativeSecondsCommand = new RelayCommand(_ => RelativeSeconds -= 5);

            // Movement commands are handled via Mouse events in code-behind
            MoveUpCommand = new RelayCommand(_ => { }); // Placeholder
            MoveDownCommand = new RelayCommand(_ => { });
            MoveLeftCommand = new RelayCommand(_ => { });
            MoveRightCommand = new RelayCommand(_ => { });
            StopCommand = new RelayCommand(_ => StopAllMovement());
            ForceStopCommand = new RelayCommand(_ => SendCommand("ESTOP:1\n"));

            SetHomeCommand = new RelayCommand(_ => SendCommand("SetH:1\n"));
            ReturnHomeCommand = new RelayCommand(_ => SendCommand("RetH:1\n"));
            ResetHomeCommand = new RelayCommand(_ => SendCommand("RstH:1\n"));

            AlignAzCommand = new RelayCommand(_ => OnAlignAz(), _ => CanAlign);
            AlignAltCommand = new RelayCommand(_ => OnAlignAlt(), _ => CanAlign);
            AlignAllCommand = new RelayCommand(_ => OnAlignAll(), _ => CanAlign);
            ToggleModifyCommand = new RelayCommand(_ => OnToggleModify(), _ => CanModify);

            // Subscribe to serial service events (using singleton)
            _serialService.PropertyChanged += OnSerialServicePropertyChanged;
            _serialService.TelemetryDataReceived += OnTelemetryDataReceived;
            _serialService.CompletionReceived += OnCompletionReceived;

            Logger.Info($"[MLAstro] ViewModel subscribed to SerialConnectionService singleton (instance: {_serialService.GetHashCode()})");
        }

        private void OnTelemetryDataReceived(object sender, TelemetryDataEventArgs e)
        {
            if (e?.Data == null)
            {
                Logger.Warning("[MLAstro] OnTelemetryDataReceived: event data is null");
                return;
            }

            Logger.Info($"[MLAstro] ViewModel received telemetry - Status: {e.Data.Status}, AzPos: {e.Data.AzPosition}");

            // Update positions from home (AzPH/AlPH)
            AzPosition = e.Data.AzPosition;
            AltPosition = e.Data.AltPosition;

            // Update moved positions (Mpos - relative to alignment start)
            AzMovedPosition = e.Data.AzMovedPosition ?? "+0° 00' 00\"";
            AltMovedPosition = e.Data.AltMovedPosition ?? "+0° 00' 00\"";

            // Update system status with color
            SystemStatus = e.Data.Status;
            StatusForeground = e.Data.Status switch
            {
                "MOVING" => Brushes.Yellow,
                "HOMING" => Brushes.Cyan,
                "ALIGNING" => Brushes.Orange,
                "ALIGN_COMPLETED" => Brushes.LimeGreen,
                "HOME_COMPLETED" => Brushes.LimeGreen,
                "ERROR" => Brushes.Red,
                "READY" => Brushes.LimeGreen,
                _ => Brushes.White
            };

            Logger.Info($"[MLAstro] ViewModel updated - SystemStatus: {SystemStatus}, StatusForeground: {StatusForeground}");

            // Update current speed level (sync from hardware)
            if (e.Data.SpeedLevel > 0 && e.Data.SpeedLevel <= 5)
            {
                CurrentSpeed = e.Data.SpeedLevel;
            }

            // Update relative mode settings (sync from hardware)
            // Don't trigger command send by using backing field
            if (_isRelativeMode != e.Data.IsRelativeMode)
            {
                _isRelativeMode = e.Data.IsRelativeMode;
                RelativeOptionsVisibility = _isRelativeMode ? Visibility.Visible : Visibility.Collapsed;
                OnPropertyChanged(nameof(IsRelativeMode));
            }

            // Update relative values (skip if user is editing)
            if (e.Data.IsRelativeMode && !_isEditingRelativeValues)
            {
                _relativeDegrees = e.Data.RelativeDegrees;
                _relativeMinutes = e.Data.RelativeMinutes;
                _relativeSeconds = e.Data.RelativeSeconds;
                OnPropertyChanged(nameof(RelativeDegrees));
                OnPropertyChanged(nameof(RelativeMinutes));
                OnPropertyChanged(nameof(RelativeSeconds));
            }

            // Update homed status from hardware (Read-Only)
            HomedStatus = e.Data.IsHomed ? "Yes" : "No";

            // Skip alignment sync if modify mode is ON OR automated adjustment is ON
            if (!_isAlignmentModifyMode && !_isAutomatedAdjustment)
            {
                // Sync alignment directions from hardware (using flag to prevent sending command back)
                _isSyncingFromTelemetry = true;
                try
                {
                    // Use property setters to ensure UI binding updates
                    AzErrorRight = e.Data.AzDirection;
                    AltErrorUp = e.Data.AltDirection;
                }
                finally
                {
                    _isSyncingFromTelemetry = false;
                }

                // Sync alignment error values from hardware
                _azErrorDeg = e.Data.AzErrorDegrees;
                _azErrorMin = e.Data.AzErrorMinutes;
                _azErrorSec = e.Data.AzErrorSeconds;
                _altErrorDeg = e.Data.AltErrorDegrees;
                _altErrorMin = e.Data.AltErrorMinutes;
                _altErrorSec = e.Data.AltErrorSeconds;
                OnPropertyChanged(nameof(AzErrorDeg));
                OnPropertyChanged(nameof(AzErrorMin));
                OnPropertyChanged(nameof(AzErrorSec));
                OnPropertyChanged(nameof(AltErrorDeg));
                OnPropertyChanged(nameof(AltErrorMin));
                OnPropertyChanged(nameof(AltErrorSec));
            }

            // Update steps display (calculate from position in degrees and steps/degree)
            if (e.Data.AzStepsPerDegree > 0)
            {
                var azSteps = (long)(e.Data.AzPositionDegrees * e.Data.AzStepsPerDegree);
                AzSteps = azSteps.ToString("N0");
            }
            else
            {
                AzSteps = "0";
            }

            if (e.Data.AltStepsPerDegree > 0)
            {
                var altSteps = (long)(e.Data.AltPositionDegrees * e.Data.AltStepsPerDegree);
                AltSteps = altSteps.ToString("N0");
            }
            else
            {
                AltSteps = "0";
            }

            // Speed values would need to be calculated from motor data
            // For now, keep placeholder values
            // AzOutSpeed, AltOutSpeed, AzMotorSpeed, AltMotorSpeed remain as initialized

            // Update WiFi indicator in firmware version (optional)
            if (!string.IsNullOrWhiteSpace(e.Data.StationIP))
            {
                // Could show WiFi status in header if needed
            }
        }

        private void OnCompletionReceived(object sender, string completionType)
        {
            switch (completionType)
            {
                case "AzAN":
                    Logger.Info("[MLAstro] Azimuth alignment completed");
                    break;
                case "AlAN":
                    Logger.Info("[MLAstro] Altitude alignment completed");
                    break;
                case "AAll":
                    Logger.Info("[MLAstro] All alignment completed");
                    break;
                case "HOME":
                    Logger.Info("[MLAstro] Home return completed");
                    // HomedStatus is now updated from telemetry (Home field)
                    break;
            }
        }

        private void OnSerialServicePropertyChanged(object sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(SerialConnectionService.IsConnected))
            {
                UpdateConnectionStatus();
            }
            else if (e.PropertyName == nameof(SerialConnectionService.HandshakeStatus))
            {
                UpdateConnectionStatus();
            }
        }

        private void UpdateConnectionStatus()
        {
            if (_serialService.IsConnected && _serialService.HandshakeStatus == "OK!")
            {
                ConnectionStatusColor = Brushes.LimeGreen;
                ConnectionStatusText = "Connected";
                ControlsVisibility = Visibility.Visible;
            }
            else if (_serialService.IsConnected && _serialService.HandshakeStatus == "NO ANSWER")
            {
                ConnectionStatusColor = Brushes.Red;
                ConnectionStatusText = "Disconnected";
                SystemStatus = "DISCONNECTED";
                StatusForeground = Brushes.Red;
                ControlsVisibility = Visibility.Collapsed;
            }
            else if (_serialService.IsConnected)
            {
                ConnectionStatusColor = Brushes.Yellow;
                ConnectionStatusText = "Connecting...";
                ControlsVisibility = Visibility.Collapsed;
            }
            else
            {
                ConnectionStatusColor = Brushes.Gray;
                ConnectionStatusText = "Disconnected";
                SystemStatus = "DISCONNECTED";
                StatusForeground = Brushes.Gray;
                ControlsVisibility = Visibility.Collapsed;
            }
        }

        private void UpdateStatusColor()
        {
            StatusForeground = SystemStatus.ToLower() switch
            {
                "error" => Brushes.Red,
                "moving" => Brushes.Yellow,
                "aligning" => Brushes.Cyan,
                "homing" => Brushes.Orange,
                _ => Brushes.White
            };
        }

        #region Command Implementations

        private void OnSetSpeed(object parameter)
        {
            if (parameter is int speed || int.TryParse(parameter?.ToString(), out speed))
            {
                CurrentSpeed = speed;
                SendCommand($"SLvl:{speed}\n");
            }
        }

        public void StartMoveUp()
        {
            if (IsRelativeMode)
            {
                SendRelativeMove("MAlU");
            }
            else
            {
                StartJogWatchdog("MAlU:1\n");
            }
        }

        public void StartMoveDown()
        {
            if (IsRelativeMode)
            {
                SendRelativeMove("MAlD");
            }
            else
            {
                StartJogWatchdog("MAlD:1\n");
            }
        }

        public void StartMoveLeft()
        {
            if (IsRelativeMode)
            {
                SendRelativeMove("MAzL");
            }
            else
            {
                StartJogWatchdog("MAzL:1\n");
            }
        }

        public void StartMoveRight()
        {
            if (IsRelativeMode)
            {
                SendRelativeMove("MAzR");
            }
            else
            {
                StartJogWatchdog("MAzR:1\n");
            }
        }

        public void StopAllMovement()
        {
            if (!IsRelativeMode)
            {
                StopJogWatchdog();
            }
            SendCommand("STOP:1\n");
        }

        private void StartJogWatchdog(string command)
        {
            _currentJogCommand = command;

            if (_jogWatchdogTimer == null)
            {
                _jogWatchdogTimer = new System.Timers.Timer(250); // Send every 250ms
                _jogWatchdogTimer.Elapsed += (s, e) =>
                {
                    if (!string.IsNullOrEmpty(_currentJogCommand) && _serialService.IsConnected)
                    {
                        _serialService.Send(_currentJogCommand);
                    }
                };
            }

            _jogWatchdogTimer.Start();
            SendCommand(command); // Send immediately first time
            Logger.Info($"[MLAstro] Started Jog watchdog: {command.TrimEnd()}");
        }

        private void StopJogWatchdog()
        {
            _jogWatchdogTimer?.Stop();

            if (!string.IsNullOrEmpty(_currentJogCommand))
            {
                // Send stop command (change :1 to :0)
                var stopCmd = _currentJogCommand.Replace(":1", ":0");
                SendCommand(stopCmd);
                Logger.Info($"[MLAstro] Stopped Jog: {stopCmd.TrimEnd()}");
                _currentJogCommand = null;
            }
        }

        private void SendRelativeMove(string axis)
        {
            // First, send relative angle setup
            SendCommand($"ReDe:{RelativeDegrees}\n");
            SendCommand($"ReAM:{RelativeMinutes}\n");
            SendCommand($"ReAS:{RelativeSeconds}\n");

            // Then send move command (just once, no watchdog needed)
            SendCommand($"{axis}:1\n");
            Logger.Info($"[MLAstro] Relative move: {axis} - {RelativeDegrees}° {RelativeMinutes}' {RelativeSeconds}\"");
        }

        private void SendMoveCommand(string command, bool start)
        {
            // Deprecated - now using StartMove* methods
            var cmd = $"{command}:{(start ? 1 : 0)}\n";
            SendCommand(cmd);
        }

        private void SendCommand(string command)
        {
            if (_serialService.IsConnected)
            {
                _serialService.Send(command);
                Logger.Info($"[MLAstro] Sent command: {command.TrimEnd()}");
            }
        }

        private void OnAlignAz()
        {
            var direction = AzErrorRight ? 1 : 0;
            var command = $"AzED:{AzErrorDeg},AzEM:{AzErrorMin},AzES:{AzErrorSec},AzAN:1\n";
            SendCommand(command);
        }

        private void OnAlignAlt()
        {
            var direction = AltErrorUp ? 1 : 0;
            var command = $"AlED:{AltErrorDeg},AlEM:{AltErrorMin},AlES:{AltErrorSec},AlAN:1\n";
            SendCommand(command);
        }

        private void OnAlignAll()
        {
            var command = $"AzED:{AzErrorDeg},AzEM:{AzErrorMin},AzES:{AzErrorSec}," +
                         $"AlED:{AltErrorDeg},AlEM:{AltErrorMin},AlES:{AltErrorSec},AAll:1\n";
            SendCommand(command);
        }

        #endregion

        #region Cleanup / Dispose

        public void Cleanup()
        {
            Dispose();
        }

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
                Logger.Info("[MLAstro] PolarAlignmentDockVM disposing...");

                // Stop jog watchdog timer
                StopJogWatchdog();
                if (_jogWatchdogTimer != null)
                {
                    _jogWatchdogTimer.Dispose();
                    _jogWatchdogTimer = null;
                }

                // Unsubscribe from serial service events
                if (_serialService != null)
                {
                    _serialService.PropertyChanged -= OnSerialServicePropertyChanged;
                    _serialService.TelemetryDataReceived -= OnTelemetryDataReceived;
                    _serialService.CompletionReceived -= OnCompletionReceived;
                }

                // Clear static instance
                lock (_instanceLock)
                {
                    if (ReferenceEquals(_instance, this))
                    {
                        _instance = null;
                    }
                }

                Logger.Info("[MLAstro] PolarAlignmentDockVM disposed");
            }

            _disposed = true;
        }

        ~PolarAlignmentDockVM()
        {
            Dispose(false);
        }

        #endregion
    }
}
