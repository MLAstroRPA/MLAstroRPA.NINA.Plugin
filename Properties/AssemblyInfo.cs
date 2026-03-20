using System.Reflection;
using System.Runtime.InteropServices;

// Plugin LongDescription - displayed in NINA Plugin Description section
[assembly: AssemblyMetadata("LongDescription", @"Robotic Polar Alignment controller for MLAstro hardware.

This plugin provides motor control for automated polar alignment adjustments. Connect to MLAstro RPA hardware via serial port to control azimuth and altitude motors.

**Features:**
* Real-time telemetry monitoring
* Configurable motor parameters (current, microsteps, acceleration)
* Soft limits for safe operation
* WiFi configuration for wireless control
* Anti-backlash compensation
* Hex mode for debugging

A new dockable panel will be available in the Imaging tab to monitor and control the polar alignment process.")]
