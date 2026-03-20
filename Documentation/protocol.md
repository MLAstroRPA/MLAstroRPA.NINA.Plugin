# MLAstro RPA - PC Serial Control Protocol Guide

This document describes the serial communication protocol used to control the MLAstro RPA (Robotic Pointing Assembly) via a PC or 3rd-party software.

## 1. Connection Settings
To communicate with the ESP32 via USB Serial, use the following port settings:
*   **Baud Rate:** `115200`
*   **Data Bits:** `8`
*   **Parity:** `None`
*   **Stop Bits:** `1`
*   **Line Ending:** Every command **MUST** be terminated with a newline character (`\n` / `LF` / Hex: `$0A`) or carriage return (`\r` / `CR` / Hex: `$0D`).

---

## 2. Handshake (Taking Control)
By default, the Web UI has full control of the mount. Before sending any movement or configuration commands via Serial, the PC software must initiate a handshake.

*   **Send:** `[MLAstroRPA-TC]\n`
*   **System Reply:** `ok\n`

**Behavior:** 
Once the handshake is accepted, the ESP32 will lock out all Web UI control to prevent conflicts. If a user manually reloads the web page, the ESP32 will drop the PC control, print `DISCONNECTED\n` to the Serial port, and wait for a new handshake.

---

## 3. Command Syntax & Logic
Commands generally follow the format `CommandPrefix:Value\n`.

### Button Press & Release Logic (UI Mapping)
To perfectly emulate GUI buttons (Mouse Down / Mouse Up), action commands support state flags:
*   `:1` represents **Button Pressed** (Start action).
*   `:0` represents **Button Released** (Stop action).

### Jog Mode Safety Watchdog (Important!)
To prevent equipment damage in case of software crashes or disconnected cables during continuous movement (Jog Mode), a **500ms Watchdog** is implemented.
*   When moving in Jog Mode, the PC software **must continually send the move command** (e.g., `MAzL:1\n`) every `200ms` to `300ms` while the button is held down.
*   If the ESP32 does not receive a repeated command within 500ms, it will automatically hit the brakes and stop the motors.
*   When the user releases the button, explicitly send the stop command (`MAzL:0\n`) to stop immediately without waiting for the timeout.
*   *(Note: This watchdog is ignored when the system is in Relative/Angle movement mode).*

---

## 4. Command Reference Table

### System & Stop Commands
| Command | Action / Description |
| :--- | :--- |
| `ESTOP:1\n` | **Emergency Stop**: Hard stop immediately (No deceleration). |
| `STOP:1\n` | **Soft Stop**: Smoothly decelerate all motors to a halt. |
| `ESTOP:0\n` / `STOP:0\n` | Ignored (Button release event). |

### Movement Commands
*Use `:1` to start moving (PC APP has to sent this once 300ms to remind hardware that the button is still pressing) and `:0` to stop. Applies to both Jog and Relative modes.*
| Command | Action / Description |
| :--- | :--- |
| `MAzL:1\n` | Move Azimuth Left (Negative direction). |
| `MAzR:1\n` | Move Azimuth Right (Positive direction). |
| `MAlU:1\n` | Move Altitude Up (Positive direction). |
| `MAlD:1\n` | Move Altitude Down (Negative direction). |
| `MAzL:0\n` | Stop Azimuth axis immediately (Decelerates smoothly). |

### Configuration Commands
| Command | Action / Description |
| :--- | :--- |
| `SLvl:X\n` | Set Speed Level, where `X` is `1` to `5`. (e.g., `SLvl:3\n`) |
| `JoRe:X\n` | Switch Movement Mode. `0` = Jog (Continuous), `1` = Relative (Angle). |

### Home Management
| Command | Action / Description |
| :--- | :--- |
| `SetH:1\n` | **Set Home Here**: Marks the current position as the `(0, 0)` reference. |
| `RetH:1\n` | **Return to Home**: Slew both axes back to the `(0, 0)` coordinate. |
| `RstH:1\n` | **Reset Home**: Clears the home status and coordinates. |
| `Home:X\n` | *(Read-Only)* Returns current home status (`1` = Homed, `0` = Not homed). |


### Relative Setup Commands (Angle Input)
*Pre-fill these values before executing a Move command in Relative mode (`JoRe:1`).*
| Command | Action / Description |
| :--- | :--- |
| `ReDe:X\n` | Set Degrees (e.g., `ReDe:45\n`). |
| `ReAM:X\n` | Set Arc Minutes (e.g., `ReAM:30\n`). |
| `ReAS:X\n` | Set Arc Seconds. |

### Alignment Commands
*Pre-fill error offsets before calling the Execute Alignment commands, or chain them together in a single string.*
| Command | Action / Description |
| :--- | :--- |
| `AzED:X\n` | Set Azimuth Error Degrees. |
| `AzEM:X\n` | Set Azimuth Error Arc Minutes. |
| `AzES:X\n` | Set Azimuth Error Arc Seconds. |
| `AzDi:X\n` | Set Azimuth Error Direction (`1` = Right/Positive, `0` = Left/Negative). |
| `AlED:X\n` | Set Altitude Error Degrees. |
| `AlEM:X\n` | Set Altitude Error Arc Minutes. |
| `AlES:X\n` | Set Altitude Error Arc Seconds. |
| `AlDi:X\n` | Set Altitude Error Direction (`1` = Up/Positive, `0` = Down/Negative). |
| `AzAN:1\n` | **Execute**: Align Azimuth axis only. |
| `AlAN:1\n` | **Execute**: Align Altitude axis only. |
| `AAll:1\n` | **Execute**: Align Both axes sequentially (Azimuth first, then Altitude). |

> **💡 Pro Tip: Alignment Command Chaining**
> You can pack the offset parameters and the execute command into a single line separated by commas. The ESP32 will automatically parse, save them to memory, and trigger the alignment.
> *   **Align Azimuth only:** `AzED:1,AzEM:30,AzES:0,AzDi:1,AzAN:1\n`
> *   **Align Altitude only:** `AlED:2,AlEM:15,AlES:0,AlDi:1,AlAN:1\n`
> *   **Align Both axes:** `AzED:1,AzEM:30,AzES:0,AzDi:1,AlED:2,AlEM:15,AlES:0,AlDi:0,AAll:1\n`
>
> *(Note: The ESP32 will reply with a single `ok\n` string for the entire chained command. The PC software should then wait for the `AzAN:COMPLETED\n`, `AlAN:COMPLETED\n`, or `AAll:COMPLETED\n` push trigger to confirm the alignment is done).*

### Advanced Settings & Configuration
*These commands update settings in memory. They will not persist after a restart unless followed by the `Save&Reboot:1\n` command. You can chain multiple commands separated by commas.*

**Motor & Soft Limits**
*   `AzL1:X\n` / `AlL1:X\n` : Set Soft Limit Min (Degrees) for Azimuth/Altitude.
*   `AzL2:X\n` / `AlL2:X\n` : Set Soft Limit Max (Degrees).
*   `AzRD:X\n` / `AlRD:X\n` : Reverse Direction (`0` = Normal, `1` = Reversed).
*   `AzIR:X\n` / `AlIR:X\n` : Set Run Current (mA).
*   `AzIH:X\n` / `AlIH:X\n` : Set Hold Current (mA).
*   `AzSB:X\n` / `AlSB:X\n` : Set Startup Booster (%).
*   `AzSC:X\n` / `AlSC:X\n` : Set Soft CoolStep (%).
*   `AzMS:X\n` / `AlMS:X\n` : Set Microsteps (e.g., `8`, `16`, `32`, `64`).
*   `AzAc:X\n` / `AlAc:X\n` : Set Acceleration.
*   `AzDec:X\n` / `AlDe:X\n` : Set Deceleration.
*   `AzSD:X\n` / `AlSD:X\n` : Set Steps per Degree.
*   `AzRM:X\n` / `AlRM:X\n` : Set Run Mode (`0` = StealthChop, `1` = SpreadCycle).

**Backlash Settings**
*   `Back:X\n` : Enable/Disable Backlash Compensation (`0` = Disable, `1` = Enable).
*   `AzBl:X\n` / `AlBl:X\n` : Set Azimuth/Altitude Backlash Steps.

**Network Settings (WiFi & Access Point)**
*   `STAs:X\n` : Set Station (WiFi) SSID (Mạng local để ESP32 kết nối vào).
*   `STAp:X\n` : Set Station (WiFi) Password.
*   `STAi:X\n` : *(Read-Only)* Trả về `ok` nhưng bỏ qua lệnh set (IP Station do Router cấp DHCP).
*   `APss:X\n` : Set Access Point (Hotspot) SSID (Tên mạng WiFi do ESP32 phát ra).
*   `APpa:X\n` : Set Access Point Password.
*   `APip:X\n` : Set Access Point IP Address (VD: `192.168.4.1`).
*   *(Ghi chú: Access Point Subnet `APsu` luôn mặc định `255.255.255.0` và Station IP `STAi` có thể đọc thông qua Telemetry).*

**Save & Reboot**
*   `Save&Reboot:1\n` : Saves all current memory parameters to FRAM and triggers a system reboot. ESP will respond with `ok` followed by `REBOOTING...`.

> **💡 Command Chaining Example:**
> Instead of sending settings one by one, you can combine them into a single string separated by commas. The system will parse them sequentially.
> **Send:** `AzL1:-9.0,AzL2:9.0,AzRD:0,AzMS:64,APss:MLAstro,Save&Reboot:1\n`

### Telemetry & Monitoring
To continuously monitor the system, the PC software should periodically send the following query command (e.g., every 300ms).

| Command | Action / Description |
| :--- | :--- |
| `?\n` | Request current system status, coordinates, and all active configuration parameters. |

**Telemetry Response Format:**
The ESP32 will reply immediately with a data string formatted as follows:
`<STATUS|Mpos:X.XXXXX,Y.YYYYY|>DATA_SETTING`

*   `STATUS`: Represents the current machine state (`READY`, `MOVING`, `HOMING`, `ALIGNING`, `CALIBRATING`, `ERROR`, `ALIGN_COMPLETED`, `HOME_COMPLETED`, `CALIB_COMPLETED`, `CENTER_COMPLETED`, `TUNING_COMPLETED`).
*   `Mpos`: The angle moved relative to the last alignment start position (Azimuth, Altitude in Decimal Degrees).
*   `DATA_SETTING`: A comma-separated list of all current system configuration variables.

**Full List of Telemetry Data Keys (DATA_SETTING):**
*   **System:** `Scal` (Scale cố định=1), `WSta` (WiFi Status: 1=Connected, 0=Disconnected), `SLvl` (Current Speed Level 1-5), `Home` (Homed status: 1/0).
*   **Relative Move:** `JoRe` (Mode: 0=Jog, 1=Relative), `ReDe` (Deg), `ReAM` (Min), `ReAS` (Sec).
*   **Alignment Settings:** `AzED`, `AzEM`, `AzES`, `AzDi` (Direction: 1/0), `AlED`, `AlEM`, `AlES`, `AlDi` (Direction: 1/0).
*   **Azimuth Settings:** `AzPH` (Current Position in Deg), `AzL1`/`AzL2` (Soft Limits Min/Max), `AzRD` (Reverse Dir: 1/0), `AzIR`/`AzIH` (Run/Hold Current mA), `AzSB`/`AzSC` (Startup Boost/Soft CoolStep %), `AzMS` (Microsteps), `AzAc`/`AzDec` (Accel/Decel), `AzSD` (Steps/Degree), `AzRM` (Run Mode: 1=SpreadCycle, 0=StealthChop).
*   **Altitude Settings:** `AlPH` (Current Position in Deg), `AlL1`/`AlL2` (Soft Limits Min/Max), `AlRD` (Reverse Dir: 1/0), `AlIR`/`AlIH` (Run/Hold Current mA), `AlSB`/`AlSC` (Startup Boost/Soft CoolStep %), `AlMS` (Microsteps), `AlAc`/`AlDe` (Accel/Decel), `AlSD` (Steps/Degree), `AlRM` (Run Mode: 1=SpreadCycle, 0=StealthChop).
*   **Backlash:** `Back` (Enabled: 1/0), `AzBl`/`AlBl` (Backlash Steps).
*   **Access Point:** `APss` (SSID), `APpa` (Pass), `APip` (IP), `APsu` (Subnet).
*   **Station (WiFi):** `STAs` (SSID), `STAp` (Pass), `STAi` (Current assigned IP từ Router).

---

## 5. System Responses
Upon receiving a command, the ESP32 will immediately process it and return a string response.

*   `ok\n` : Command was successfully received and executed.
*   `error: System Locked\n` : Action rejected because the system is in an Error/Hardlimit state (Needs reset).
*   `error: Hard Limit\n` : Action rejected because the requested direction is blocked by a physical StallGuard trigger.
*   `error: Soft Limit\n` : Action rejected because the target coordinates are outside the configured minimum/maximum safety angles.
*   `error: Not homed\n` : Action rejected (e.g., trying to Return Home without setting one first).
*   `error: Unknown command\n` : The command prefix is invalid.

---
*End of Protocol Guide*