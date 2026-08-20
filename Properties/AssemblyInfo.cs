using System.Reflection;
using System.Runtime.InteropServices;

// Plugin LongDescription - displayed in NINA Plugin Description section
[assembly: AssemblyMetadata("LongDescription", @"Robotic Polar Alignment controller for MLAstro hardware.

This plugin provides the same control and configuration as the MLAstro RPA webserver, except for the deep system settings.

**Features:**
* Real-time telemetry monitoring
* Configurable motor parameters (current, microsteps, acceleration)
* Soft limits for safe operation
* WiFi configuration for wireless control
* Anti-backlash compensation")]
