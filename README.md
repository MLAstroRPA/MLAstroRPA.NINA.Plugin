# MLAstroRPA.NINA.Plugin
# MLAstro Robotic Polar Alignment - N.I.N.A Plugin

## Overview

**MLAstro Robotic Polar Alignment** is a plugin for N.I.N.A (Nighttime Imaging 'N' Astronomy) that provides automated polar alignment control for equatorial mounts using the MLAstro RPA (Robotic Pointing Assembly) hardware controller.

This plugin allows you to:
- Control Azimuth and Altitude adjustments via serial communication
- Perform automated polar alignment based on Three Point Polar Alignment (TPPA) error data
- Configure motor driver settings (TMC2209)
- Manage soft limits and backlash compensation
- Monitor real-time telemetry from the hardware

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Installation Guide](#installation-guide)
3. [Hardware Setup](#hardware-setup)
4. [User Guide](#user-guide)
   - [Serial Connection](#serial-connection)
   - [Control Panel](#control-panel)
   - [Polar Alignment Workflow](#polar-alignment-workflow)
   - [Configuration Options](#configuration-options)
5. [Troubleshooting](#troubleshooting)
6. [Technical Reference](#technical-reference)

---

## System Requirements

### Software
- **N.I.N.A** version 3.0 or later
- **Windows 10/11** (64-bit)
- **.NET 8.0 Runtime** or later

### Hardware
- **MLAstro RPA Controller** (ESP32-based)
- **USB Cable** (Type-C or Micro-USB depending on your controller)
- **TMC2209 Stepper Motor Drivers** (integrated in the controller)
- **Stepper Motors** for Azimuth and Altitude axes

---

## Installation Guide

### Step 1: Download the Plugin

1. Download the latest release of `MLAstro_Robotic_Polar_Alignment.dll` from the [GitHub Releases](https://github.com/MLAstroRPA/MLAstroRPA-NINA.Plugin/releases) page.

### Step 2: Install the Plugin

**Method A: Manual Installation**
1. Locate your N.I.N.A plugins folder:
   - Default path: `%LOCALAPPDATA%\NINA\Plugins\`
   - Or: `C:\Users\<YourUsername>\AppData\Local\NINA\Plugins\`
2. Create a new folder named `MLAstro_Robotic_Polar_Alignment`
3. Copy the downloaded `.dll` file into this folder
4. Restart N.I.N.A

**Method B: Via N.I.N.A Plugin Manager**
1. Open N.I.N.A
2. Go to **Options** → **Plugins**
3. Search for "MLAstro Robotic Polar Alignment"
4. Click **Install**
5. Restart N.I.N.A when prompted

### Step 3: Verify Installation

1. Open N.I.N.A
2. Go to **Options** → **Plugins**
3. Confirm "MLAstro Robotic Polar Alignment" appears in the list and is enabled
4. The plugin control panel should now be available in the **Imaging** tab

---

## Hardware Setup

### Connecting the Controller

1. **Connect USB Cable**: Plug the USB cable from the MLAstro RPA Controller to your computer
2. **Install Drivers**: Windows should automatically install CH340 or CP2102 USB-to-Serial drivers
3. **Identify COM Port**: 
   - Open Device Manager
   - Expand "Ports (COM & LPT)"
   - Note the COM port number (e.g., COM3, COM4)

### Initial Power-On

1. Power on the MLAstro RPA Controller
2. The controller LED should indicate ready status
3. The WiFi hotspot (default: `MLAstro`) will become available for web interface access

---

## User Guide

### Serial Connection

#### Connecting to the Controller

1. Open N.I.N.A and navigate to the **MLAstro RPA Options** panel
2. In the **Serial Communication** section:
   - Click **Refresh Ports** to detect available COM ports
   - Select your COM port from the dropdown
   - Baud Rate: **115200** (default, do not change)
   - Data Bits: 8, Parity: None, Stop Bits: 1 (fixed)
3. Click **Connect**
4. Wait for the **Handshake** status to show **"OK!"**

#### Connection Status Indicators

| Status | Meaning |
|--------|---------|
| `Disconnected` | Not connected to any COM port |
| `Connected: COMx @ 115200` | Successfully connected |
| `Handshake: OK!` | Controller recognized and ready |
| `Handshake: NO ANSWER` | Controller not responding (check connections) |

#### Serial Terminal

The Serial Terminal displays all communication between the plugin and the controller:
- **Pink text**: Commands sent to the controller
- **Gray text**: Responses received from the controller
- **Green text**: Connection events
- **Red text**: Disconnection events

**Terminal Controls:**
- Right-click to access the context menu
- **Copy**: Copy selected text
- **Clear**: Clear terminal history
- **Hex display**: Toggle hexadecimal display mode

**Hex Input Mode:**
- Check the **Hex** checkbox to send raw hexadecimal bytes
- Input accepts up to 16 hex characters (e.g., `48454C4C4F`)

---

### Control Panel

The main control panel is accessible from the **Imaging** tab in N.I.N.A.

#### Status Display

| Field | Description |
|-------|-------------|
| **Status** | Current controller state (READY, MOVING, ALIGNING, etc.) |
| **Az Position** | Current Azimuth position from home (degrees, minutes, seconds) |
| **Alt Position** | Current Altitude position from home (degrees, minutes, seconds) |
| **Moved Az/Alt** | Distance moved during current alignment operation |
| **WiFi** | WiFi connection status indicator |
| **Home** | Home position status indicator |

#### Speed Control

Five speed levels are available (1-5):
- **Level 1**: Slowest - for fine adjustments
- **Level 3**: Default - balanced speed
- **Level 5**: Fastest - for large movements

Click the speed buttons to change the movement speed.

#### Movement Controls

**Jog Mode (Continuous)**
- Press and hold direction buttons to move continuously
- Release to stop
- Includes safety watchdog (auto-stop after 500ms without command)

**Relative Mode (Angle)**
- Set specific degrees/minutes/seconds values
- Click direction to move exact amount
- Toggle between modes using the **Jog/Relative** switch

**Direction Buttons:**
| Button | Action |
|--------|--------|
| ◀ / ▶ | Move Azimuth Left / Right |
| ▲ / ▼ | Move Altitude Up / Down |

#### Home Management

| Button | Function |
|--------|----------|
| **Set Home** | Mark current position as (0,0) reference |
| **Return Home** | Move back to home position |
| **Reset Home** | Clear home reference |

#### Emergency Controls

| Button | Function |
|--------|----------|
| **STOP** | Smooth deceleration stop |
| **E-STOP** | Immediate hard stop (emergency) |

---

### Polar Alignment Workflow

#### Prerequisites

1. Mount is roughly polar aligned (within a few degrees)
2. Controller is connected and handshake successful
3. Home position is set (optional but recommended)

#### Step-by-Step Alignment

**Step 1: Perform TPPA Measurement**
1. Use N.I.N.A's built-in Three Point Polar Alignment (TPPA) tool
2. Complete the three-point measurement sequence
3. Note the reported Azimuth and Altitude errors

**Step 2: Enter Alignment Errors**
1. In the MLAstro control panel, locate the **Alignment** section
2. Enter the Azimuth error:
   - **Az Degrees**: Whole degrees
   - **Az Minutes**: Arc minutes
   - **Az Seconds**: Arc seconds
   - **Az Direction**: Right (+) or Left (-)
3. Enter the Altitude error:
   - **Alt Degrees**: Whole degrees
   - **Alt Minutes**: Arc minutes
   - **Alt Seconds**: Arc seconds
   - **Alt Direction**: Up (+) or Down (-)

**Step 3: Execute Alignment**
1. Click **Align Both** to adjust both axes (recommended)
   - Or click **Align Az** / **Align Alt** for individual axis adjustment
2. Wait for the controller to complete the movement
3. Status will show **COMPLETED** when finished

**Step 4: Verify Alignment**
1. Run TPPA again to verify the new alignment
2. Repeat steps 2-4 if errors remain
3. Typically 2-3 iterations achieve sub-arcminute accuracy

#### Alignment Tips

- Start with larger errors first, then fine-tune
- Use slower speed levels for final adjustments
- Set home position before starting alignment for reference
- The "Moved" display shows cumulative adjustment during alignment

---

### Configuration Options

Access configuration via **Options** → **Equipment** → **MLAstro Robotic Polar Alignment**

> **Note:** Configuration sections are only visible after successful handshake

#### Soft Limits (Degrees)

Set safety boundaries for each axis:
- **AZ Min/Max**: Azimuth travel limits
- **ALT Min/Max**: Altitude travel limits

The controller will refuse movements beyond these limits.

#### Motor Driver (TMC2209)

Configure stepper motor parameters for each axis:

| Parameter | Description | Typical Range |
|-----------|-------------|---------------|
| **Reverse Direction** | Invert motor direction | On/Off |
| **Run Current (mA)** | Motor current during movement | 400-2000 |
| **Hold Current (mA)** | Motor current when stationary | 100-500 |
| **Start-up Booster (%)** | Extra torque at movement start | 0-100 |
| **Soft CoolStep (%)** | Dynamic current reduction | 0-100 |
| **Microsteps** | Microstepping resolution | 1-256 |
| **Accel (steps/s²)** | Acceleration rate | 1000-50000 |
| **Decel (steps/s²)** | Deceleration rate | 1000-50000 |
| **Steps/Degree** | Mechanical gear ratio | Depends on hardware |
| **Mode** | StealthChop (quiet) / SpreadCycle (torque) | - |

#### Anti Backlash

- **Enable**: Turn on hardware backlash compensation
- **AZ Backlash (steps)**: Azimuth backlash value
- **ALT Backlash (steps)**: Altitude backlash value

#### WiFi Configuration

**Access Point (Hotspot)**
- Configure the controller's own WiFi network
- Default SSID: `MLAstro`

**Station Mode**
- Connect controller to your existing WiFi network
- Current IP is displayed after connection

#### Saving Configuration

1. Check **Modify Mode** to enable editing
2. Make your changes
3. Click **SAVE ALL SETTINGS & REBOOT**
4. Controller will save to FRAM and restart
5. Reconnect after reboot

---

## Troubleshooting

### Connection Issues

| Problem | Solution |
|---------|----------|
| COM port not listed | Click Refresh Ports; Check USB connection; Reinstall drivers |
| Handshake: NO ANSWER | Verify baud rate (115200); Check controller power; Try different USB port |
| Connection drops | Check USB cable quality; Avoid USB hubs; Update USB drivers |

### Movement Issues

| Problem | Solution |
|---------|----------|
| Motor not moving | Check motor connections; Verify current settings; Check soft limits |
| Movement in wrong direction | Toggle "Reverse Direction" in motor settings |
| Jerky movement | Reduce acceleration; Check microstep settings |
| Motor stalling | Increase run current; Check mechanical binding |

### Alignment Issues

| Problem | Solution |
|---------|----------|
| Alignment not completing | Check soft limits; Verify error values; Ensure not at limit |
| Overcorrection | Verify Steps/Degree setting matches your hardware |
| Undercorrection | Check backlash settings; Verify gear ratio |

### Communication Errors

| Error Message | Meaning |
|---------------|---------|
| `error: System Locked` | Controller in error state - restart required |
| `error: Hard Limit` | Physical limit switch triggered |
| `error: Soft Limit` | Software limit reached - adjust limits or position |
| `error: Not homed` | Home position required for this operation |

---

## Technical Reference

### Serial Protocol

- **Baud Rate**: 115200
- **Format**: 8-N-1 (8 data bits, no parity, 1 stop bit)
- **Line Ending**: `\n` (LF) or `\r` (CR)
- **Handshake Command**: `[MLAstroRPA-TC]\n`

### Telemetry Format

```
<STATUS|Mpos:±X.XXXXX,±Y.YYYYY|>DATA_SETTINGS
```

- `STATUS`: READY, MOVING, ALIGNING, ERROR, etc.
- `Mpos`: Current moved position in decimal degrees
- `DATA_SETTINGS`: Comma-separated configuration values

### Command Examples

```
# Movement
MAzL:1\n    # Start moving Azimuth left
MAzL:0\n    # Stop Azimuth

# Speed
SLvl:3\n    # Set speed level 3

# Alignment
AzED:0,AzEM:30,AzES:15,AzAN:1\n    # Align Azimuth by 0° 30' 15"

# Configuration
AzMS:64,Save&Reboot:1\n    # Set microsteps to 64 and save
```

---

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/MLAstroRPA/MLAstroRPA-NINA.Plugin/issues)
- **Documentation**: [Full protocol reference](Services/protocol.md)

---

## License

This plugin is provided under the MIT License. See LICENSE file for details.

---

*Last updated: 2024*
