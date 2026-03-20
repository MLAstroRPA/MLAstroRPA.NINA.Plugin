using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.ComponentModel.Composition;
using System.Globalization;
using System.IO.Ports;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using MLAstro_Robotic_Polar_Alignment.Settings;
using NINA.Core.Utility;
 
namespace MLAstro_Robotic_Polar_Alignment.Services
{
    [Export(typeof(SerialConnectionService))]
    [PartCreationPolicy(CreationPolicy.Shared)]
    public class SerialConnectionService : INotifyPropertyChanged, IDisposable
    { 
        private const int MaxTerminalEntries = 500;
        private const string InitialHandshakeCommand = "[MLAstroRPA-TC]\n";
        private const string ConnectionCheckCommand = "?\n";
        private const string ExpectedHandshakeResponse = "ok";
        private const int HandshakeTimeoutMilliseconds = 1000;

        // Track all instances to control timers globally
        private static readonly List<SerialConnectionService> _allInstances = new();
        private static readonly object _instancesLock = new();

        // Static flag to pause query on ALL instances
        private static bool _pauseQueryGlobal;
        public static bool PauseQueryGlobal
        {
            get => _pauseQueryGlobal;
            set
            {
                _pauseQueryGlobal = value;
                Logger.Info($"[MLAstro] PauseQueryGlobal set to: {value}, total instances: {_allInstances.Count}");
            }
        }

        // Static singleton instance to ensure all components use the same instance
        private static SerialConnectionService _instance;
        private static readonly object _instanceLock = new();

        /// <summary>
        /// Gets the singleton instance of SerialConnectionService.
        /// Use this property instead of MEF injection to ensure single instance across all components.
        /// </summary>
        public static SerialConnectionService Instance
        {
            get
            {
                if (_instance == null)
                {
                    lock (_instanceLock)
                    {
                        _instance ??= new SerialConnectionService(PluginSettings.Instance);
                    }
                }
                return _instance;
            }
        }

        private readonly PluginSettings _settings;
        private readonly StringBuilder _telemetryBuffer = new();
        private bool _pauseTelemetryUpdates;
        private SerialPort _serialPort;
        private string[] _availablePorts = Array.Empty<string>();
        private string _connectionStatus = "Disconnected";
        private string _handshakeStatus = string.Empty;
        private bool _hexDisplay;
        private readonly object _responseSync = new();
        private readonly SemaphoreSlim _serialOperationSemaphore = new(1, 1);
        private readonly StringBuilder _responseBuffer = new();
        private TaskCompletionSource<bool> _pendingOkResponse;
        private bool _receivedAnyResponse;
        private System.Timers.Timer _connectionCheckTimer;
        private int _connectionCheckInProgress;

        public event PropertyChangedEventHandler PropertyChanged;
        public event EventHandler<TelemetryDataEventArgs> TelemetryDataReceived;
        public event EventHandler<string> CompletionReceived;

        [ImportingConstructor]
        public SerialConnectionService(PluginSettings settings)
        {
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));

            // Register this instance
            lock (_instancesLock)
            {
                _allInstances.Add(this);
                Logger.Info($"[MLAstro] SerialConnectionService CREATED: instance={this.GetHashCode()}, total instances={_allInstances.Count}");
            }

            // Register as singleton if not already set
            lock (_instanceLock)
            {
                _instance ??= this;
            }
        }

        public ObservableCollection<SerialTerminalEntry> TerminalEntries { get; } = new();

        public string[] AvailablePorts
        {
            get => _availablePorts;
            private set
            {
                _availablePorts = value;
                OnPropertyChanged();
            }
        }

        public bool IsConnected => _serialPort?.IsOpen == true;

        public bool HexDisplay
        {
            get => _hexDisplay;
            set
            {
                if (_hexDisplay == value)
                {
                    return;
                }

                _hexDisplay = value;
                RefreshTerminalDisplay();
                OnPropertyChanged();
            }
        }

        public string ConnectionStatus
        {
            get => _connectionStatus;
            private set
            {
                _connectionStatus = value;
                OnPropertyChanged();
            }
        }

        public string HandshakeStatus
        {
            get => _handshakeStatus;
            private set
            {
                if (_handshakeStatus == value)
                {
                    return;
                }

                _handshakeStatus = value;
                OnPropertyChanged();
            }
        }

        public bool PauseTelemetryUpdates
        {
            get => _pauseTelemetryUpdates;
            set
            {
                _pauseTelemetryUpdates = value;
                OnPropertyChanged();
            }
        }

        public void RefreshPorts()
        {
            AvailablePorts = SerialPort.GetPortNames()
                .OrderBy(p => p, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        public bool Connect(string portName, int baudRate)
        {
            if (string.IsNullOrWhiteSpace(portName))
            {
                ConnectionStatus = "No COM port selected";
                return false;
            }

            try
            {
                Disconnect();

                _serialPort = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One)
                {
                    Handshake = Handshake.None,
                    ReadTimeout = 1000,
                    WriteTimeout = 1000,
                    Encoding = Encoding.UTF8
                };
                _serialPort.DataReceived += OnSerialPortDataReceived;
                _serialPort.Open();

                ConnectionStatus = $"Connected: {portName} @ {baudRate} (8-N-1)";
                HandshakeStatus = string.Empty;
                AppendTerminalEntry(SerialTerminalEntry.Connected(ConnectionStatus));
                OnPropertyChanged(nameof(IsConnected));
                Logger.Info($"[MLAstro] Serial connected: {portName} @ {baudRate} (8-N-1)");
                _ = StartHandshakeAndConnectionChecksAsync();
                return true;
            }
            catch (Exception ex)
            {
                ConnectionStatus = $"Connect failed: {ex.Message}";
                Logger.Warning($"[MLAstro] Serial connect failed: {ex.Message}");
                DisconnectPortInstance();
                OnPropertyChanged(nameof(IsConnected));
                return false;
            }
        }

        public bool SendHex(string hexText)
        {
            if (!IsConnected)
            {
                ConnectionStatus = "Not connected";
                return false;
            }

            if (string.IsNullOrWhiteSpace(hexText))
            {
                return false;
            }

            var normalizedHex = new string(hexText.Where(Uri.IsHexDigit).ToArray());
            if (normalizedHex.Length == 0)
            {
                return false;
            }

            if (normalizedHex.Length % 2 != 0)
            {
                ConnectionStatus = "Hex input must contain an even number of digits";
                return false;
            }

            try
            {
                var data = Enumerable.Range(0, normalizedHex.Length / 2)
                    .Select(i => Convert.ToByte(normalizedHex.Substring(i * 2, 2), 16))
                    .ToArray();

                _serialPort.Write(data, 0, data.Length);
                AppendTerminalEntry(SerialTerminalEntry.Sent(data, _serialPort.Encoding, HexDisplay));
                return true;
            }
            catch (Exception ex)
            {
                ConnectionStatus = $"Hex send failed: {ex.Message}";
                Logger.Warning($"[MLAstro] Serial hex send failed: {ex.Message}");
                return false;
            }
        }

        public void Disconnect()
        {
            if (_serialPort == null)
            {
                ConnectionStatus = "Disconnected";
                HandshakeStatus = string.Empty;
                OnPropertyChanged(nameof(IsConnected));
                return;
            }

            var portName = _serialPort.PortName;
            DisconnectPortInstance();
            ConnectionStatus = "Disconnected";
            HandshakeStatus = string.Empty;
            AppendTerminalEntry(SerialTerminalEntry.Disconnected($"Disconnected: {portName}"));
            OnPropertyChanged(nameof(IsConnected));
            Logger.Info($"[MLAstro] Serial disconnected: {portName}");
        }

        public bool Send(string text)
        {
            if (!IsConnected)
            {
                ConnectionStatus = "Not connected";
                return false;
            }

            if (string.IsNullOrWhiteSpace(text))
            {
                return false;
            }

            try
            {
                var data = _serialPort.Encoding.GetBytes(text);
                _serialPort.Write(data, 0, data.Length);
                AppendTerminalEntry(SerialTerminalEntry.Sent(data, _serialPort.Encoding, HexDisplay));

                // Log sent commands (exclude telemetry query for cleaner logs)
                if (!text.Equals("?\n"))
                {
                    Logger.Info($"[MLAstro] Command sent: {text.TrimEnd('\r', '\n')}");
                }

                return true;
            }
            catch (Exception ex)
            {
                ConnectionStatus = $"Send failed: {ex.Message}";
                Logger.Warning($"[MLAstro] Serial send failed: {ex.Message}");
                return false;
            }
        }

        public void ClearTerminal()
        {
            InvokeOnUiThread(() => TerminalEntries.Clear());
        }

        public bool QueryTelemetry()
        {
            if (PauseQueryGlobal)
            {
                return false;
            }

            return Send("?\n");
        }

        public string BuildConfigurationCommand(PluginSettings settings)
        {
            if (settings == null)
            {
                return string.Empty;
            }

            var parts = new System.Collections.Generic.List<string>();

            // Soft Limits
            parts.Add($"AzL1:{settings.LimitAzMin.ToString(CultureInfo.InvariantCulture)}");
            parts.Add($"AzL2:{settings.LimitAzMax.ToString(CultureInfo.InvariantCulture)}");
            parts.Add($"AlL1:{settings.LimitAltMin.ToString(CultureInfo.InvariantCulture)}");
            parts.Add($"AlL2:{settings.LimitAltMax.ToString(CultureInfo.InvariantCulture)}");

            // Azimuth Motor
            parts.Add($"AzRD:{(settings.AzReverse ? 1 : 0)}");
            parts.Add($"AzIR:{settings.AzCurrentRun}");
            parts.Add($"AzIH:{settings.AzCurrentHold}");
            parts.Add($"AzSB:{settings.AzBooster}");
            parts.Add($"AzSC:{settings.AzCoolStep}");
            parts.Add($"AzMS:{settings.AzMicrosteps}");
            parts.Add($"AzAc:{settings.AzAccel}");
            parts.Add($"AzDec:{settings.AzDecel}");
            parts.Add($"AzSD:{settings.AzStepsPerDegree.ToString(CultureInfo.InvariantCulture)}");
            parts.Add($"AzRM:{settings.AzMode}");

            // Altitude Motor
            parts.Add($"AlRD:{(settings.AltReverse ? 1 : 0)}");
            parts.Add($"AlIR:{settings.AltCurrentRun}");
            parts.Add($"AlIH:{settings.AltCurrentHold}");
            parts.Add($"AlSB:{settings.AltBooster}");
            parts.Add($"AlSC:{settings.AltCoolStep}");
            parts.Add($"AlMS:{settings.AltMicrosteps}");
            parts.Add($"AlAc:{settings.AltAccel}");
            parts.Add($"AlDe:{settings.AltDecel}");
            parts.Add($"AlSD:{settings.AltStepsPerDegree.ToString(CultureInfo.InvariantCulture)}");
            parts.Add($"AlRM:{settings.AltMode}");

            // Backlash
            parts.Add($"Back:{(settings.BacklashEnabled ? 1 : 0)}");
            parts.Add($"AzBl:{settings.BacklashAz}");
            parts.Add($"AlBl:{settings.BacklashAlt}");

            // WiFi Settings
            if (!string.IsNullOrWhiteSpace(settings.ApSsid))
                parts.Add($"APss:{settings.ApSsid}");
            if (!string.IsNullOrWhiteSpace(settings.ApPass))
                parts.Add($"APpa:{settings.ApPass}");
            if (!string.IsNullOrWhiteSpace(settings.ApIp))
                parts.Add($"APip:{settings.ApIp}");
            if (!string.IsNullOrWhiteSpace(settings.WifiSsid))
                parts.Add($"STAs:{settings.WifiSsid}");
            if (!string.IsNullOrWhiteSpace(settings.WifiPass))
                parts.Add($"STAp:{settings.WifiPass}");

            // Add Save&Reboot command at the end
            parts.Add("Save&Reboot:1");

            return string.Join(",", parts) + "\n";
        }

        private void OnSerialPortDataReceived(object sender, SerialDataReceivedEventArgs e)
        {
            try
            {
                if (_serialPort == null)
                {
                    return;
                }

                var bytesToRead = _serialPort.BytesToRead;
                if (bytesToRead <= 0)
                {
                    return;
                }

                var buffer = new byte[bytesToRead];
                var bytesRead = _serialPort.Read(buffer, 0, bytesToRead);
                if (bytesRead <= 0)
                {
                    return;
                }

                if (bytesRead != buffer.Length)
                {
                    Array.Resize(ref buffer, bytesRead);
                }

                AppendTerminalEntry(SerialTerminalEntry.Received(buffer, _serialPort.Encoding, HexDisplay));
                var receivedText = _serialPort.Encoding.GetString(buffer);

                // Log received data for debugging
                if (receivedText.Contains("<") || receivedText.Contains(">"))
                {
                    Logger.Info($"[MLAstro] Telemetry received: {receivedText.Substring(0, Math.Min(200, receivedText.Length))}...");
                }
                else if (receivedText.Contains("ok"))
                {
                    Logger.Info($"[MLAstro] OK response received");
                }
                else if (receivedText.Contains("error"))
                {
                    Logger.Warning($"[MLAstro] Error response: {receivedText}");
                }
                else if (receivedText.Contains("COMPLETED"))
                {
                    Logger.Info($"[MLAstro] Completion event: {receivedText}");
                }

                // Check for DISCONNECTED signal from device - auto disconnect
                if (receivedText.Contains("DISCONNECTED"))
                {
                    Logger.Info("[MLAstro] DISCONNECTED signal received from device - auto disconnecting");
                    Application.Current?.Dispatcher?.BeginInvoke(new Action(() =>
                    {
                        Disconnect();
                    }));
                    return;
                }

                // Check for completion events
                CheckForCompletionEvents(receivedText);

                ProcessPendingResponse(buffer, _serialPort.Encoding);
                ProcessTelemetryData(receivedText);
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Serial receive failed: {ex.Message}");
            }
        }

        private async Task StartHandshakeAndConnectionChecksAsync()
        {
            await SendAndAwaitOkAsync(InitialHandshakeCommand).ConfigureAwait(false);

            if (IsConnected)
            {
                StartConnectionCheckTimer();
            }
        }

        private void StartConnectionCheckTimer()
        {
            if (_connectionCheckTimer != null)
            {
                return;
            }

            _connectionCheckTimer = new System.Timers.Timer(1000)
            {
                AutoReset = true
            };
            _connectionCheckTimer.Elapsed += (_, _) => _ = RunConnectionCheckAsync();
            _connectionCheckTimer.Start();
        }

        private void StopConnectionCheckTimer()
        {
            if (_connectionCheckTimer == null)
            {
                return;
            }

            _connectionCheckTimer.Stop();
            _connectionCheckTimer.Dispose();
            _connectionCheckTimer = null;
            Interlocked.Exchange(ref _connectionCheckInProgress, 0);
        }

        private async Task RunConnectionCheckAsync()
        {
            // Skip if paused globally
            if (PauseQueryGlobal)
            {
                return;
            }

            if (!IsConnected || Interlocked.Exchange(ref _connectionCheckInProgress, 1) == 1)
            {
                return;
            }

            try
            {
                await SendAndAwaitOkAsync(ConnectionCheckCommand).ConfigureAwait(false);
            }
            finally
            {
                Interlocked.Exchange(ref _connectionCheckInProgress, 0);
            }
        }

        private async Task<bool> SendAndAwaitOkAsync(string text)
        {
            if (!IsConnected || string.IsNullOrWhiteSpace(text))
            {
                return false;
            }

            TaskCompletionSource<bool> pendingResponse = null;
            var receivedData = false;

            await _serialOperationSemaphore.WaitAsync().ConfigureAwait(false);
            try
            {
                if (!IsConnected || _serialPort == null)
                {
                    return false;
                }

                pendingResponse = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                lock (_responseSync)
                {
                    _responseBuffer.Clear();
                    _receivedAnyResponse = false;
                    _pendingOkResponse = pendingResponse;
                }

                var data = _serialPort.Encoding.GetBytes(text);
                _serialPort.Write(data, 0, data.Length);
                AppendTerminalEntry(SerialTerminalEntry.Sent(data, _serialPort.Encoding, HexDisplay));

                var completedTask = await Task.WhenAny(pendingResponse.Task, Task.Delay(HandshakeTimeoutMilliseconds)).ConfigureAwait(false);

                lock (_responseSync)
                {
                    receivedData = _receivedAnyResponse;
                }

                var gotOk = completedTask == pendingResponse.Task && pendingResponse.Task.Result;

                // Only update to "NO ANSWER" if we didn't receive any data at all
                if (!gotOk && !receivedData)
                {
                    UpdateHandshakeStatus(false);
                }
                else if (gotOk)
                {
                    UpdateHandshakeStatus(true);
                }
                // If received data but not "ok", don't change the status

                return gotOk;
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Serial handshake/check failed: {ex.Message}");
                return false;
            }
            finally
            {
                lock (_responseSync)
                {
                    if (ReferenceEquals(_pendingOkResponse, pendingResponse))
                    {
                        _pendingOkResponse = null;
                    }

                    _responseBuffer.Clear();
                }

                _serialOperationSemaphore.Release();
            }
        }

        private void CheckForCompletionEvents(string receivedText)
        {
            if (string.IsNullOrWhiteSpace(receivedText))
            {
                return;
            }

            // Check for completion messages
            if (receivedText.Contains("COMPLETED"))
            {
                if (receivedText.Contains("AzAN:COMPLETED"))
                {
                    CompletionReceived?.Invoke(this, "AzAN");
                    Logger.Info("[MLAstro] Azimuth alignment completed");
                }
                else if (receivedText.Contains("AlAN:COMPLETED"))
                {
                    CompletionReceived?.Invoke(this, "AlAN");
                    Logger.Info("[MLAstro] Altitude alignment completed");
                }
                else if (receivedText.Contains("AAll:COMPLETED"))
                {
                    CompletionReceived?.Invoke(this, "AAll");
                    Logger.Info("[MLAstro] All alignment completed");
                }
                else if (receivedText.Contains("HOME_COMPLETED"))
                {
                    CompletionReceived?.Invoke(this, "HOME");
                    Logger.Info("[MLAstro] Home return completed");
                }
            }
        }

        private void ProcessPendingResponse(byte[] buffer, Encoding encoding)
        {
            if (buffer == null || buffer.Length == 0)
            {
                return;
            }

            lock (_responseSync)
            {
                if (_pendingOkResponse == null)
                {
                    return;
                }

                // Mark that we received data
                _receivedAnyResponse = true;

                var receivedText = (encoding ?? Encoding.UTF8).GetString(buffer);
                _responseBuffer.Append(receivedText);

                var bufferContent = _responseBuffer.ToString();
                if (bufferContent.Contains(ExpectedHandshakeResponse, StringComparison.Ordinal))
                {
                    _pendingOkResponse.TrySetResult(true);
                }
            }
        }

        private void ProcessTelemetryData(string receivedText)
        {
            if (string.IsNullOrWhiteSpace(receivedText))
            {
                return;
            }

            try
            {
                _telemetryBuffer.Append(receivedText);
                var bufferContent = _telemetryBuffer.ToString();

                // Check if we have a complete telemetry message: <...>...
                if (bufferContent.Contains('<') && bufferContent.Contains('>'))
                {
                    var startIdx = bufferContent.IndexOf('<');
                    var endIdx = bufferContent.IndexOf('>', startIdx);

                    if (endIdx > startIdx)
                    {
                        // Find end of telemetry data (newline after the data section)
                        var lineEndIdx = bufferContent.IndexOfAny(new[] { '\r', '\n' }, endIdx);
                        if (lineEndIdx > endIdx || bufferContent.Length > endIdx + 100) // Complete or long enough
                        { 
                            var telemetryLine = lineEndIdx > 0 
                                ? bufferContent.Substring(startIdx, lineEndIdx - startIdx)
                                : bufferContent.Substring(startIdx);

                            Logger.Info($"[MLAstro] Processing telemetry line: {telemetryLine.Substring(0, Math.Min(100, telemetryLine.Length))}...");

                            // Parse telemetry and raise event
                            var telemetryData = ParseTelemetryLine(telemetryLine);
                            if (telemetryData != null)
                            {
                                Logger.Info($"[MLAstro] Telemetry parsed - Status: {telemetryData.Status}, AzPos: {telemetryData.AzPosition}, AltPos: {telemetryData.AltPosition}");
                                Logger.Info($"[MLAstro] Raising TelemetryDataReceived event (instance: {this.GetHashCode()}, subscribers: {TelemetryDataReceived?.GetInvocationList().Length ?? 0})");
                                TelemetryDataReceived?.Invoke(this, new TelemetryDataEventArgs(telemetryData));
                            }
                            else
                            {
                                Logger.Warning("[MLAstro] ParseTelemetryLine returned null");
                            }

                            // Only update settings if not paused
                            if (!PauseTelemetryUpdates)
                            {
                                TelemetryParser.ParseAndApplySettings(telemetryLine, _settings);
                                Logger.Info("[MLAstro] Telemetry data received and parsed");
                            }

                            // Clear buffer after successful parse
                            _telemetryBuffer.Clear();
                            if (lineEndIdx > 0 && lineEndIdx < bufferContent.Length - 1)
                            {
                                _telemetryBuffer.Append(bufferContent.Substring(lineEndIdx + 1));
                            }
                        }
                    }
                }
                else if (_telemetryBuffer.Length > 1000)
                {
                    // Buffer too large without complete telemetry, clear it
                    _telemetryBuffer.Clear();
                }
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Telemetry processing failed: {ex.Message}");
                _telemetryBuffer.Clear();
            }
        }

        private void UpdateHandshakeStatus(bool isOk)
        {
            InvokeOnUiThread(() => HandshakeStatus = isOk ? "OK!" : "NO ANSWER");
        }

        private void ResetPendingHandshakeState()
        {
            StopConnectionCheckTimer();

            lock (_responseSync)
            {
                _responseBuffer.Clear();
                _pendingOkResponse?.TrySetResult(false);
                _pendingOkResponse = null;
            }
        }

        private void AppendTerminalEntry(SerialTerminalEntry entry)
        {
            InvokeOnUiThread(() =>
            {
                TerminalEntries.Add(entry);
                while (TerminalEntries.Count > MaxTerminalEntries)
                {
                    TerminalEntries.RemoveAt(0);
                }
            });
        }

        private void RefreshTerminalDisplay()
        {
            InvokeOnUiThread(() =>
            {
                foreach (var entry in TerminalEntries)
                {
                    entry.SetHexDisplay(HexDisplay);
                }
            });
        }

        private void InvokeOnUiThread(Action action)
        {
            if (Application.Current?.Dispatcher != null && !Application.Current.Dispatcher.CheckAccess())
            {
                Application.Current.Dispatcher.BeginInvoke(action);
                return;
            }

            action();
        }

        private void DisconnectPortInstance()
        {
            try
            {
                ResetPendingHandshakeState();

                if (_serialPort != null)
                {
                    _serialPort.DataReceived -= OnSerialPortDataReceived;
                }

                if (_serialPort?.IsOpen == true)
                {
                    _serialPort.Close();
                }
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Serial disconnect failed: {ex.Message}");
            }
            finally 
            {
                _serialPort?.Dispose();
                _serialPort = null;
            }
        }

        public void Dispose()
        {
            Logger.Info("[MLAstro] SerialConnectionService disposing...");

            // Stop connection check timer first
            StopConnectionCheckTimer();

            // Reset pending handshake state
            ResetPendingHandshakeState();

            // Clear event subscribers to prevent memory leaks
            TelemetryDataReceived = null;
            CompletionReceived = null;
            PropertyChanged = null;

            // Clear terminal entries
            InvokeOnUiThread(() => TerminalEntries.Clear());

            // Dispose semaphore
            _serialOperationSemaphore.Dispose();

            // Disconnect and dispose serial port
            DisconnectPortInstance();

            // Clear static instance reference to allow GC
            lock (_instanceLock)
            {
                if (ReferenceEquals(_instance, this))
                {
                    _instance = null;
                }
            }

            Logger.Info("[MLAstro] SerialConnectionService disposed");
        }

        protected virtual void OnPropertyChanged([CallerMemberName] string propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }

        private TelemetryData ParseTelemetryLine(string telemetryLine)
        {
            if (string.IsNullOrWhiteSpace(telemetryLine))
            {
                Logger.Info("[MLAstro] ParseTelemetryLine: telemetryLine is null or empty");
                return null;
            }

            try
            {
                // Format: <STATUS|Mpos:+-X.XXXXX,+/-Y.YYYYY|>DATA_SETTING
                var startIdx = telemetryLine.IndexOf('<');
                var endIdx = telemetryLine.IndexOf('>');

                if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx)
                {
                    Logger.Info($"[MLAstro] ParseTelemetryLine: Invalid format - startIdx={startIdx}, endIdx={endIdx}");
                    return null;
                }

                var headerSection = telemetryLine.Substring(startIdx + 1, endIdx - startIdx - 1);
                Logger.Info($"[MLAstro] ParseTelemetryLine: Header section = {headerSection}");

                var parts = headerSection.Split('|');

                if (parts.Length < 2)
                {
                    Logger.Info($"[MLAstro] ParseTelemetryLine: Not enough parts - {parts.Length}");
                    return null;
                }

                var data = new TelemetryData
                {
                    Status = parts[0].Trim()
                };

                // Parse Mpos from header (format: Mpos:+-X.XXXXX,+/-Y.YYYYY)
                foreach (var part in parts)
                {
                    if (part.StartsWith("Mpos:"))
                    {
                        ParseMovedPosition(part, data);
                        break;
                    }
                }

                // Parse DATA_SETTING section after '>' (contains AzPH, AlPH for position from home)
                if (endIdx < telemetryLine.Length - 1)
                {
                    var dataSection = telemetryLine.Substring(endIdx + 1);
                    Logger.Info($"[MLAstro] ParseTelemetryLine: Data section length = {dataSection.Length}");
                    ParseDataSettings(dataSection, data);
                }

                // Convert AzPH/AlPH decimal degrees to display format for position from home
                data.AzPosition = FormatDegreesToDMS(data.AzPositionDegrees);
                data.AltPosition = FormatDegreesToDMS(data.AltPositionDegrees);

                Logger.Info($"[MLAstro] ParseTelemetryLine: Parsed Status={data.Status}, AzPos={data.AzPosition}, AltPos={data.AltPosition}");

                return data;
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Parse telemetry header failed: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Converts decimal degrees (e.g., +1.234567 or -0.567890) to DMS format for display.
        /// Format: AzPH:+/-X.XXXXX -> "+X° MM' SS\""
        /// </summary>
        private string FormatDegreesToDMS(double decimalDegrees)
        {
            try
            {
                var isNegative = decimalDegrees < 0;
                var absValue = Math.Abs(decimalDegrees);

                var degrees = (int)absValue;
                var remainder = (absValue - degrees) * 60;
                var minutes = (int)remainder;
                var seconds = (int)Math.Round((remainder - minutes) * 60);

                // Handle seconds overflow
                if (seconds >= 60)
                {
                    seconds -= 60;
                    minutes++;
                }
                if (minutes >= 60)
                {
                    minutes -= 60;
                    degrees++;
                }

                var sign = isNegative ? "-" : "+";
                return $"{sign}{degrees}° {minutes:D2}' {seconds:D2}\"";
            }
            catch
            {
                return "+0° 00' 00\"";
            }
        }

        /// <summary>
        /// Parses Mpos field from header: Mpos:+-X.XXXXX,+/-Y.YYYYY
        /// where X = Azimuth moved, Y = Altitude moved (relative to alignment start)
        /// </summary>
        private void ParseMovedPosition(string mposData, TelemetryData data)
        {
            try
            {
                // Format: Mpos:+-X.XXXXX,+/-Y.YYYYY
                var colonIdx = mposData.IndexOf(':');
                if (colonIdx < 0) return;

                var values = mposData.Substring(colonIdx + 1).Split(',');
                if (values.Length != 2) return;

                if (double.TryParse(values[0].Trim(), NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var azMoved))
                {
                    data.AzMovedDegrees = azMoved;
                    data.AzMovedPosition = FormatDegreesToDMS(azMoved);
                }

                if (double.TryParse(values[1].Trim(), NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var altMoved))
                {
                    data.AltMovedDegrees = altMoved;
                    data.AltMovedPosition = FormatDegreesToDMS(altMoved);
                }

                Logger.Info($"[MLAstro] ParseMovedPosition: Az={data.AzMovedPosition}, Alt={data.AltMovedPosition}");
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] ParseMovedPosition failed: {ex.Message}");
            }
        }

        private void ParseDataSettings(string dataSection, TelemetryData data)
        {
            if (string.IsNullOrWhiteSpace(dataSection) || data == null)
            {
                return;
            }

            try
            {
                var parameters = dataSection.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);

                foreach (var param in parameters)
                {
                    var parts = param.Split(new[] { ':' }, 2);
                    if (parts.Length != 2)
                    {
                        continue;
                    }

                    var key = parts[0].Trim();
                    var value = parts[1].Trim();

                    switch (key)
                    {
                        // System
                        case "SLvl":
                            if (int.TryParse(value, out var speedLevel))
                                data.SpeedLevel = speedLevel;
                            break;
                        case "WSta":
                            if (int.TryParse(value, out var wifiStatus))
                                data.WifiConnected = wifiStatus == 1;
                            break;

                        // Relative Mode
                        case "JoRe":
                            if (int.TryParse(value, out var joRe))
                                data.IsRelativeMode = joRe == 1;
                            break;
                        case "ReDe":
                            if (int.TryParse(value, out var reDe))
                                data.RelativeDegrees = reDe;
                            break;
                        case "ReAM":
                            if (int.TryParse(value, out var reAm))
                                data.RelativeMinutes = reAm;
                            break;
                        case "ReAS":
                            if (int.TryParse(value, out var reAs))
                                data.RelativeSeconds = reAs;
                            break;

                        // Azimuth
                        case "AzPH":
                            if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var azPh))
                                data.AzPositionDegrees = azPh;
                            break;
                        case "AzSD":
                            if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var azSd))
                                data.AzStepsPerDegree = azSd;
                            break;

                        // Altitude
                        case "AlPH":
                            if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var alPh))
                                data.AltPositionDegrees = alPh;
                            break;
                        case "AlSD":
                            if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var alSd))
                                data.AltStepsPerDegree = alSd;
                            break;

                        // WiFi Info
                        case "STAi":
                            data.StationIP = value;
                            break;

                        // Home status (Read-Only from hardware)
                        case "Home":
                            if (int.TryParse(value, out var home))
                                data.IsHomed = home == 1;
                            break;

                        // Alignment directions (Read/Write)
                        case "AzDi":
                            if (int.TryParse(value, out var azDi))
                                data.AzDirection = azDi == 1;
                            break;
                        case "AlDi":
                            if (int.TryParse(value, out var alDi))
                                data.AltDirection = alDi == 1;
                            break;

                        // Alignment error values
                        case "AzED":
                            if (int.TryParse(value, out var azED))
                                data.AzErrorDegrees = azED;
                            break;
                        case "AzEM":
                            if (int.TryParse(value, out var azEM))
                                data.AzErrorMinutes = azEM;
                            break;
                        case "AzES":
                            if (int.TryParse(value, out var azES))
                                data.AzErrorSeconds = azES;
                            break;
                        case "AlED":
                            if (int.TryParse(value, out var alED))
                                data.AltErrorDegrees = alED;
                            break;
                        case "AlEM":
                            if (int.TryParse(value, out var alEM))
                                data.AltErrorMinutes = alEM;
                            break;
                        case "AlES":
                            if (int.TryParse(value, out var alES))
                                data.AltErrorSeconds = alES;
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Parse data settings failed: {ex.Message}");
            }
        }
    }

    public class TelemetryData
    {
        public string Status { get; set; }
        public string AzPosition { get; set; }
        public string AltPosition { get; set; }

        // System
        public int SpeedLevel { get; set; } = 3;
        public bool WifiConnected { get; set; }
        public bool IsHomed { get; set; }

        // Mode
        public bool IsRelativeMode { get; set; }
        public int RelativeDegrees { get; set; }
        public int RelativeMinutes { get; set; }
        public int RelativeSeconds { get; set; }

        // Positions (in degrees) - from home
        public double AzPositionDegrees { get; set; }
        public double AltPositionDegrees { get; set; }

        // Moved positions (in degrees) - relative to alignment start
        public double AzMovedDegrees { get; set; }
        public double AltMovedDegrees { get; set; }
        public string AzMovedPosition { get; set; }
        public string AltMovedPosition { get; set; }

        // Steps configuration
        public double AzStepsPerDegree { get; set; } = 1.0;
        public double AltStepsPerDegree { get; set; } = 1.0;

        // Alignment directions (1 = Right/Up, 0 = Left/Down)
        public bool AzDirection { get; set; }
        public bool AltDirection { get; set; }

        // Alignment error values
        public int AzErrorDegrees { get; set; }
        public int AzErrorMinutes { get; set; }
        public int AzErrorSeconds { get; set; }
        public int AltErrorDegrees { get; set; }
        public int AltErrorMinutes { get; set; }
        public int AltErrorSeconds { get; set; }

        // Network
        public string StationIP { get; set; }
    }

    public class TelemetryDataEventArgs : EventArgs
    {
        public TelemetryData Data { get; }

        public TelemetryDataEventArgs(TelemetryData data)
        {
            Data = data;
        }
    }

    public class SerialTerminalEntry : INotifyPropertyChanged
    {
        private readonly byte[] _payload;
        private readonly string _statusText;
        private readonly Encoding _encoding;
        private bool _hexDisplay;
        private string _displayText;

        private SerialTerminalEntry(SerialTerminalEntryType entryType, byte[] payload, string statusText, Encoding encoding, bool hexDisplay)
        {
            EntryType = entryType;
            _payload = payload;
            _statusText = statusText;
            _encoding = encoding ?? Encoding.UTF8;
            _hexDisplay = hexDisplay;
            _displayText = FormatDisplayText();
        }

        public event PropertyChangedEventHandler PropertyChanged;

        public SerialTerminalEntryType EntryType { get; }

        public string DisplayText
        {
            get => _displayText;
            private set
            {
                if (_displayText != value)
                {
                    _displayText = value;
                    PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(DisplayText)));
                }
            }
        }

        public Brush Foreground => EntryType switch
        {
            SerialTerminalEntryType.Sent => Brushes.DeepPink,
            SerialTerminalEntryType.Connected => Brushes.LimeGreen,
            SerialTerminalEntryType.Disconnected => Brushes.IndianRed,
            _ => Brushes.Gray
        };

        public static SerialTerminalEntry Sent(byte[] payload, Encoding encoding, bool hexDisplay)
            => new(SerialTerminalEntryType.Sent, payload, null, encoding, hexDisplay);

        public static SerialTerminalEntry Received(byte[] payload, Encoding encoding, bool hexDisplay)
            => new(SerialTerminalEntryType.Received, payload, null, encoding, hexDisplay);

        public static SerialTerminalEntry Connected(string text)
            => new(SerialTerminalEntryType.Connected, null, text, Encoding.UTF8, false);

        public static SerialTerminalEntry Disconnected(string text)
            => new(SerialTerminalEntryType.Disconnected, null, text, Encoding.UTF8, false);

        public void SetHexDisplay(bool hexDisplay)
        {
            if (_hexDisplay == hexDisplay)
            {
                return;
            }

            _hexDisplay = hexDisplay;
            DisplayText = FormatDisplayText();
        }

        private string FormatDisplayText()
        {
            if (EntryType == SerialTerminalEntryType.Connected || EntryType == SerialTerminalEntryType.Disconnected)
            {
                return _statusText ?? string.Empty;
            }

            if (_payload == null || _payload.Length == 0)
            {
                return string.Empty;
            }

            if (_hexDisplay)
            {
                return string.Join(" ", _payload.Select(b => b.ToString("X2")));
            }

            return _encoding.GetString(_payload).TrimEnd('\r', '\n');
        }
    }

    public enum SerialTerminalEntryType
    {
        Received,
        Sent,
        Connected,
        Disconnected
    }

    public static class TelemetryParser
    {
        public static void ParseAndApplySettings(string telemetryData, PluginSettings settings)
        {
            if (string.IsNullOrWhiteSpace(telemetryData) || settings == null)
            {
                return;
            }

            try
            {
                // Format: <STATUS|AzMP:D,M,S|AlMP:D,M,S|>DATA_SETTING
                var startIndex = telemetryData.IndexOf('>');
                if (startIndex < 0)
                {
                    return;
                }

                var dataSection = telemetryData.Substring(startIndex + 1);
                var parameters = dataSection.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);

                Logger.Info($"[MLAstro] Parsing {parameters.Length} parameters from telemetry");

                foreach (var param in parameters)
                {
                    var parts = param.Split(new[] { ':' }, 2);
                    if (parts.Length != 2)
                    {
                        continue;
                    }

                    var key = parts[0].Trim();
                    var value = parts[1].Trim();

                    // Log WiFi-related parameters
                    if (key.StartsWith("STA") || key.StartsWith("AP"))
                    {
                        Logger.Info($"[MLAstro] WiFi param: {key} = {value}");
                    }

                    MapParameterToSettings(key, value, settings);
                }
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Telemetry parse failed: {ex.Message}");
            }
        }

        private static void MapParameterToSettings(string key, string value, PluginSettings settings)
        {
            try
            {
                switch (key)
                {
                    // Soft Limits
                    case "AzL1":
                        if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var azMin))
                            settings.LimitAzMin = azMin;
                        break;
                    case "AzL2":
                        if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var azMax))
                            settings.LimitAzMax = azMax;
                        break;
                    case "AlL1":
                        if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var altMin))
                            settings.LimitAltMin = altMin;
                        break;
                    case "AlL2":
                        if (double.TryParse(value, NumberStyles.Float | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var altMax))
                            settings.LimitAltMax = altMax;
                        break;

                    // Azimuth Motor Settings
                    case "AzRD":
                        if (int.TryParse(value, out var azReverse))
                            settings.AzReverse = azReverse != 0;
                        break;
                    case "AzIR":
                        if (int.TryParse(value, out var azCurrentRun))
                            settings.AzCurrentRun = azCurrentRun;
                        break;
                    case "AzIH":
                        if (int.TryParse(value, out var azCurrentHold))
                            settings.AzCurrentHold = azCurrentHold;
                        break;
                    case "AzSB":
                        if (int.TryParse(value, out var azBooster))
                            settings.AzBooster = azBooster;
                        break;
                    case "AzSC":
                        if (int.TryParse(value, out var azCoolStep))
                            settings.AzCoolStep = azCoolStep;
                        break;
                    case "AzMS":
                        if (int.TryParse(value, out var azMicrosteps))
                            settings.AzMicrosteps = azMicrosteps;
                        break;
                    case "AzAc":
                        if (int.TryParse(value, out var azAccel))
                            settings.AzAccel = azAccel;
                        break;
                    case "AzDec":
                        if (int.TryParse(value, out var azDecel))
                            settings.AzDecel = azDecel;
                        break;
                    case "AzSD":
                        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var azStepsPerDegree))
                            settings.AzStepsPerDegree = azStepsPerDegree;
                        break;
                    case "AzRM":
                        if (int.TryParse(value, out var azMode))
                            settings.AzMode = azMode;
                        break;

                    // Altitude Motor Settings
                    case "AlRD":
                        if (int.TryParse(value, out var altReverse))
                            settings.AltReverse = altReverse != 0;
                        break;
                    case "AlIR":
                        if (int.TryParse(value, out var altCurrentRun))
                            settings.AltCurrentRun = altCurrentRun;
                        break;
                    case "AlIH":
                        if (int.TryParse(value, out var altCurrentHold))
                            settings.AltCurrentHold = altCurrentHold;
                        break;
                    case "AlSB":
                        if (int.TryParse(value, out var altBooster))
                            settings.AltBooster = altBooster;
                        break;
                    case "AlSC":
                        if (int.TryParse(value, out var altCoolStep))
                            settings.AltCoolStep = altCoolStep;
                        break;
                    case "AlMS":
                        if (int.TryParse(value, out var altMicrosteps))
                            settings.AltMicrosteps = altMicrosteps;
                        break;
                    case "AlAc":
                        if (int.TryParse(value, out var altAccel))
                            settings.AltAccel = altAccel;
                        break;
                    case "AlDe":
                        if (int.TryParse(value, out var altDecel))
                            settings.AltDecel = altDecel;
                        break;
                    case "AlSD":
                        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var altStepsPerDegree))
                            settings.AltStepsPerDegree = altStepsPerDegree;
                        break;
                    case "AlRM":
                        if (int.TryParse(value, out var altMode))
                            settings.AltMode = altMode;
                        break;

                    // Backlash
                    case "Back":
                        if (int.TryParse(value, out var backlashEnabled))
                            settings.BacklashEnabled = backlashEnabled != 0;
                        break;
                    case "AzBl":
                        if (int.TryParse(value, out var azBacklash))
                            settings.BacklashAz = azBacklash;
                        break;
                    case "AlBl":
                        if (int.TryParse(value, out var altBacklash))
                            settings.BacklashAlt = altBacklash;
                        break;

                    // WiFi Settings
                    case "APss":
                        settings.ApSsid = value;
                        break;
                    case "APpa":
                        settings.ApPass = value;
                        break;
                    case "APip":
                        settings.ApIp = value;
                        break;
                    case "STAs":
                        settings.WifiSsid = value;
                        break;
                    case "STAp":
                        settings.WifiPass = value;
                        break;
                    case "STAi":
                        settings.WifiIp = value;
                        Logger.Info($"[MLAstro] STAi mapped: {value}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Logger.Warning($"[MLAstro] Failed to map parameter {key}={value}: {ex.Message}");
            }
        }
    }
}
