// ===== WebSocket Connection =====
let ws = null;
let reconnectInterval = null;
let isSystemHomed = false; // Biến lưu trạng thái Homed từ server
let wasAutoMoving = false; // Biến lưu trạng thái di chuyển trước đó để phát hiện khi nào hoàn thành
let currentFwVer = "unknown";
let currentSpiffsVer = "unknown";
let hasSystemError = false;
let isSystemCalibrating = false; // Biến lưu trạng thái đang Calib
let isCalibAutoCenterPending = false; // Biến cờ theo dõi quy trình Auto Center sau Calib
let isUpdatingFromWS = false; // Cờ chặn gửi lệnh lưu khi đang cập nhật từ Server
let backendWsConnected = false;
let backendWsChecked = false;
let systemLocked = false; // true = đang do PC (Serial) điều khiển -> khóa nút điều khiển web
let isRebooting = false; // giữ trạng thái REBOOTING cho đến khi reboot hoàn tất

// Chart Variables
let sgChartCtx = null;
const sgHistoryLength = 100;
let lastCalibData = null; // Lưu kết quả calib tạm thời
let sgDataAz = new Array(sgHistoryLength).fill(0);
let sgDataAlt = new Array(sgHistoryLength).fill(0);
let csDataAz = new Array(sgHistoryLength).fill(0);
let csDataAlt = new Array(sgHistoryLength).fill(0);
let otaPlan = null;
let otaCurrentStepIndex = -1;
let otaMode = 'ota';
let espWebToolsLoader = null;
let usbFlashProgressHint = 0;
let usbFlashPhase = 'preparing';
let activeUsbManifestUrl = null;
let activeUsbLocalBlobUrls = [];

const ESP_WEB_TOOLS_MODULE_URL = 'https://unpkg.com/esp-web-tools@9/dist/web/install-button.js?module';
const PUBLIC_USB_UPDATE_URL = 'https://mlastrorpa.github.io/Update/';
const FLASH_OFFSETS = {
  bootloader: '0x1000',
  partitions: '0x8000',
  firmware: '0x10000',
  spiffs: '0x290000',
};
const FLASH_KIND_ORDER = ['bootloader', 'partitions', 'firmware', 'spiffs'];

// Helper: Trích xuất số phiên bản x.x.x từ chuỗi
function extractVersion(text) {
  if (!text) return "unknown";
  const match = text.match(/\d+\.\d+\.\d+/);
  return match ? match[0].trim() : "unknown";
}


// ===== MODAL FUNCTIONS =====
const modal = document.getElementById('generic-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalFooter = document.getElementById('modal-footer');
const modalCloseBtn = document.getElementById('modal-close-btn');
const otaInstallOverlay = document.getElementById('ota-install-overlay');
const otaInstallRing = document.getElementById('ota-install-ring');
const otaInstallPercent = document.getElementById('ota-install-percent');
const otaInstallPhase = document.getElementById('ota-install-phase');
const otaInstallViewInstalling = document.getElementById('ota-install-view-installing');
const otaInstallViewSuccess = document.getElementById('ota-install-view-success');
const otaInstallSuccessCountdown = document.getElementById('ota-install-success-countdown');
let otaSuccessCountdownTimer = null;

function showModal(title, content, buttons = []) {
  if (!modal) return;
  
  // Tự động thêm icon cảnh báo nếu phát hiện từ khóa lỗi
  let displayTitle = title;
  const t = title.toLowerCase();
  const c = (typeof content === 'string') ? content.toLowerCase() : '';

  if (t.includes('blocked') || t.includes('error') || t.includes('warning') || 
      c.includes('blocked') || c.includes('locked') || c.includes('error') || c.includes('failed') || 
      c.includes('hard limit reached') || c.includes('out of limit')) {
    if (!displayTitle.includes('⚠️')) displayTitle = '⚠️ ' + displayTitle;
  }

  modal.classList.remove('modal-passive', 'modal-detached');
  modalTitle.textContent = displayTitle;
  modalBody.innerHTML = content;
  modalFooter.innerHTML = '';

  buttons.forEach(btnInfo => {
    const button = document.createElement('button');
    button.textContent = btnInfo.text;
    button.className = `btn ${btnInfo.class || 'btn-secondary'}`;
    if (btnInfo.id) button.id = btnInfo.id;
    button.addEventListener('click', () => {
      if (btnInfo.callback) {
        btnInfo.callback();
      }
      // By default, close modal on button click, unless specified otherwise
      if (btnInfo.closeOnClick !== false) {
          hideModal();
      }
    });
    modalFooter.appendChild(button);
  });

  modal.style.display = 'block';
}

function hideModal() {
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('modal-passive', 'modal-detached');
  }
  clearUsbDashboardHost(document.getElementById('update-modal-usb-host'));
  activeSoftLimitErrorKey = '';
}

// ===== CONNECTION LOCKED OVERLAY =====
// Hiển thị overlay khóa toàn màn hình khi bị từ chối kết nối
// Overlay này KHÔNG THỂ ĐÓNG, chỉ có nút "Close This Page"
function showConnectionLockedOverlay(reason) {
  const overlay = document.getElementById('connection-locked-overlay');
  const reasonEl = document.getElementById('connection-locked-reason');
  if (!overlay) return;

  if (reasonEl) {
    reasonEl.textContent = reason;
  }

  // Ẩn toàn bộ nội dung trang, chỉ hiện overlay
  overlay.classList.remove('hidden');

  // Vô hiệu hóa tất cả tương tác với trang bên dưới
  document.body.style.overflow = 'hidden';

  // Dừng mọi kết nối đang chờ
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
  }
}

// Gắn sự kiện cho nút "Close This Page"
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('connection-locked-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      // Thử đóng tab/cửa sổ, nếu không được thì chuyển hướng
      if (window.close) {
        window.close();
      }
      // Fallback: nếu window.close() không hoạt động (trên mobile hoặc tab không được mở bởi script)
      // thì hiển thị thông báo yêu cầu người dùng tự đóng
      setTimeout(() => {
        document.body.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0D1B2B;color:#e0e0e0;font-family:sans-serif;text-align:center;padding:20px;">
            <div>
              <div style="font-size:64px;margin-bottom:16px;">🔒</div>
              <h2 style="color:#e74c3c;margin-bottom:12px;">Please Close This Tab</h2>
              <p style="color:#a0a0a0;">The connection was rejected. Please manually close this browser tab.</p>
            </div>
          </div>`;
      }, 300);
    });
  }
});

function hideOtaProgressUI() {
  const progressContainer = document.getElementById('ota-progress-container');
  if (progressContainer) progressContainer.classList.add('hidden');
}

function showOtaInstallOverlay(phaseText = 'Preparing update...', percent = 0) {
  hideOtaProgressUI();
  if (!otaInstallOverlay) return;
  if (otaSuccessCountdownTimer) {
    clearInterval(otaSuccessCountdownTimer);
    otaSuccessCountdownTimer = null;
  }
  if (otaInstallViewInstalling) otaInstallViewInstalling.classList.remove('hidden');
  if (otaInstallViewSuccess) otaInstallViewSuccess.classList.add('hidden');
  otaInstallOverlay.classList.remove('hidden');
  updateOtaInstallOverlay(percent, phaseText);
}

function updateOtaInstallOverlay(percent, phaseText) {
  if (!otaInstallOverlay) return;
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (otaInstallRing) {
    otaInstallRing.style.setProperty('--ota-progress-angle', `${safePercent * 3.6}deg`);
  }
  if (otaInstallPercent) otaInstallPercent.textContent = `${Math.round(safePercent)}%`;
  if (otaInstallPhase && phaseText) otaInstallPhase.textContent = phaseText;
}

function hideOtaInstallOverlay() {
  if (!otaInstallOverlay) return;
  if (otaSuccessCountdownTimer) {
    clearInterval(otaSuccessCountdownTimer);
    otaSuccessCountdownTimer = null;
  }
  otaInstallOverlay.classList.add('hidden');
}

function showOtaInstallSuccessCountdown(seconds = 3) {
  if (!otaInstallOverlay) return;
  if (otaInstallViewInstalling) otaInstallViewInstalling.classList.add('hidden');
  if (otaInstallViewSuccess) otaInstallViewSuccess.classList.remove('hidden');
  otaInstallOverlay.classList.remove('hidden');

  let remaining = seconds;
  if (otaInstallSuccessCountdown) {
    otaInstallSuccessCountdown.textContent = `REBOOTING IN ${remaining}s`;
  }

  if (otaSuccessCountdownTimer) {
    clearInterval(otaSuccessCountdownTimer);
  }

  otaSuccessCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(otaSuccessCountdownTimer);
      otaSuccessCountdownTimer = null;
      if (otaInstallSuccessCountdown) {
        otaInstallSuccessCountdown.textContent = 'REBOOTING...';
      }
      return;
    }
    if (otaInstallSuccessCountdown) {
      otaInstallSuccessCountdown.textContent = `REBOOTING IN ${remaining}s`;
    }
  }, 1000);
}

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, Math.round(num)));
}

let activeSoftLimitErrorKey = '';

function normalizeSoftLimitInputs() {
  const azMinEl = document.getElementById('limit-az-min');
  const azMaxEl = document.getElementById('limit-az-max');
  const altMinEl = document.getElementById('limit-alt-min');
  const altMaxEl = document.getElementById('limit-alt-max');

  if (!azMinEl || !azMaxEl || !altMinEl || !altMaxEl) {
    return null;
  }

  const limits = {
    az_min: clampInt(azMinEl.value, -9, 9),
    az_max: clampInt(azMaxEl.value, -9, 9),
    alt_min: clampInt(altMinEl.value, -14, 14),
    alt_max: clampInt(altMaxEl.value, -14, 14)
  };

  azMinEl.value = String(limits.az_min);
  azMaxEl.value = String(limits.az_max);
  altMinEl.value = String(limits.alt_min);
  altMaxEl.value = String(limits.alt_max);

  return limits;
}

function validateSoftLimitsRelation(showModalOnError = false) {
  const limits = normalizeSoftLimitInputs();
  if (!limits) return true;

  let errorKey = '';
  let errorMsg = '';

  if (limits.az_min >= limits.az_max) {
    errorKey = 'az';
    errorMsg = 'AZ Min must be smaller than AZ Max.';
  }
  else if (limits.alt_min >= limits.alt_max) {
    errorKey = 'alt';
    errorMsg = 'ALT Min must be smaller than ALT Max.';
  }

  if (!errorKey) {
    activeSoftLimitErrorKey = '';
    return true;
  }

  if (showModalOnError && activeSoftLimitErrorKey !== errorKey) {
    showModal('Invalid Soft Limit', errorMsg, [{ text: 'OK', class: 'btn-warning' }]);
  }
  activeSoftLimitErrorKey = errorKey;
  return false;
}

function validateSoftLimitsBeforeSave() {
  if (!validateSoftLimitsRelation(true)) {
    return false;
  }
  return true;
}

function bindSoftLimitInputGuards() {
  const ids = ['limit-az-min', 'limit-az-max', 'limit-alt-min', 'limit-alt-max'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const onUserEdit = () => {
      validateSoftLimitsRelation(true);
    };
    el.addEventListener('input', onUserEdit);
    el.addEventListener('change', onUserEdit);
    el.addEventListener('blur', onUserEdit);
  });
}

function hasBackendConnection() {
  return Boolean(ws && ws.readyState === WebSocket.OPEN && backendWsConnected);
}

function markBackendDisconnected() {
  backendWsConnected = false;
  backendWsChecked = true;
}

function waitForBackendStatus(timeoutMs = 1200) {
  if (backendWsChecked) {
    return Promise.resolve(hasBackendConnection());
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (backendWsChecked || (Date.now() - startedAt) >= timeoutMs) {
        clearInterval(timer);
        resolve(hasBackendConnection());
      }
    }, 100);
  });
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + window.location.host + '/ws');
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    backendWsConnected = true;
    backendWsChecked = true;
    isRebooting = false; // reset trạng thái chờ reboot khi kết nối mới
    // Trạng thái sẽ được cập nhật khi nhận gói tin đầu tiên chứa RSSI
    if (reconnectInterval) clearInterval(reconnectInterval);
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // --- CONNECTION CONTROL: Xử lý thông báo từ chối kết nối từ Server ---
      if (data.cmd === 'connectionRejected') {
        console.warn('WebSocket connection rejected:', data.reason);
        showConnectionLockedOverlay(data.reason || 'System is busy.');
        // Đóng WebSocket và KHÔNG auto-reconnect
        if (ws) {
          ws.onclose = null; // Ngăn onclose gọi reconnect
          ws.close();
          ws = null;
        }
        if (reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
        }
        return;
      }

      updateUI(data);
    } catch (e) {
      console.error('JSON parse error:', e);
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    markBackendDisconnected();
    updateWifiIcon(-1000); // Hiển thị mất kết nối
  };
  
  ws.onclose = () => {
    console.log('WebSocket closed');
    markBackendDisconnected();
    updateWifiIcon(-1000); // Hiển thị mất kết nối
    // Attempt reconnect every 3 seconds (trừ khi đã bị từ chối)
    if (!reconnectInterval) {
      reconnectInterval = setInterval(connectWebSocket, 3000);
    }
  };
}

// ===== HELPER: FORMAT DMS =====
function toDMS(deg) {
  const sign = deg >= 0 ? '+' : '-';
  const abs = Math.abs(deg);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = ((abs - d) * 60 - m) * 60;
  
  // Làm tròn giây lấy số nguyên
  s = Math.round(s);
  if (s >= 60) { s = 0; m++; }
  if (m >= 60) { m = 0; d++; }

  return `${sign}${d}° ${m.toString().padStart(2, '0')}' ${s.toString().padStart(2, '0')}"`;
}

// ===== UI UPDATE =====
function updateUI(data) {
  if(data.status){
    console.log('WebSocket status:', data.status);
    if(data.status === 'configSaved'){
      showMessage('✓ Settings saved to flash.', '#save-message', 3000);
    } else if(data.status === 'configApplied'){
      showMessage('⚡ Settings applied (not saved). Reboot to discard.', '#save-message', 4000);
    }
  }

  // Config nhận từ serial (broadcastConfig) - tương đương nhấn Apply
  if (data.config_pushed && data.motor) {
    showMessage('⚡ Config received from device. Applied.', '#save-message', 4000);
  }
  
  // Xử lý phản hồi đăng nhập Admin
  if (data.cmd === 'loginAdmin') {
    const passInput = document.getElementById('admin-pass-input');
    if (data.result) {
      const adminPanel = document.querySelector('.admin-panel');
      if (adminPanel) {
        adminPanel.classList.add('admin-panel-active');
      }
      hideModal(); // Close login modal on success
      showMessage('Admin mode unlocked', '#save-message', 2000);
    } else {
      const errorEl = document.getElementById('admin-login-error');
      if (errorEl) {
        errorEl.textContent = 'Incorrect Password!';
        errorEl.style.display = 'block';
      }
      const passInput = document.getElementById('admin-pass-input-modal');
      if (passInput) {
        passInput.value = '';
        passInput.focus();
      }
    }
  }

  // Xử lý phản hồi đổi mật khẩu Admin
  if (data.cmd === 'changePassword') {
    if (data.result) {
      showMessage('✓ Password changed successfully!', '#change-pass-msg', 4000);
      const oldEl = document.getElementById('admin-old-pass');
      const newEl = document.getElementById('admin-new-pass');
      if (oldEl) oldEl.value = '';
      if (newEl) newEl.value = '';
    } else {
      showMessage('⚠ Failed: incorrect current password or invalid new password.', '#change-pass-msg', 4000);
    }
  }

  // Xử lý kết quả Calibration
  if (data.cmd === 'calibResult') {
    if (data.axis === 'all') {
        const msg = `<strong>Calibration ALL Axes Completed!</strong><br><br>` +
                    `<strong>Azimuth:</strong> ${data.az_steps} steps / ${data.az_travel}° = ${data.az_spd.toFixed(5)} steps/deg<br>` +
                    `<strong>Altitude:</strong> ${data.alt_steps} steps / ${data.alt_travel}° = ${data.alt_spd.toFixed(5)} steps/deg`;
        
        showModal('Calibration Result', msg, [
            { text: 'Apply All', class: 'btn-success', callback: () => {
                document.getElementById('az-spd').value = data.az_spd.toFixed(5);
                document.getElementById('alt-spd').value = data.alt_spd.toFixed(5);
                showMessage('Values applied. Please click SAVE ALL to persist.', '#save-message', 5000);
            }},
            { text: 'Apply result & Auto center', class: 'btn-warning', callback: () => {
                document.getElementById('az-spd').value = data.az_spd.toFixed(5);
                document.getElementById('alt-spd').value = data.alt_spd.toFixed(5);
                sendCommand('autoCenter', { axis: 'all' });
                isCalibAutoCenterPending = true; // Đánh dấu đang đợi Auto Center hoàn tất
                showMessage('Moving to Center & Setting Home...', '#save-message', 5000);
            }},
            { text: 'Close', class: 'btn-secondary' }
        ]);
        return;
    }

    lastCalibData = data;
    let axisName = data.axis === 'az' ? 'Azimuth' : 'Altitude';
    let range = data.travel || (data.axis === 'az' ? 20 : 30);
    const msg = `<strong>${axisName} Calibration Completed!</strong><br><br>` +
                `Total Steps: ${data.steps} (Range ~${range}°)<br>` +
                `Calculated: <strong>${data.spd.toFixed(5)}</strong> steps/deg`;

    showModal('Calibration Result', msg, [
        { text: 'Apply Steps/Deg Only', class: 'btn-success', callback: () => {
            document.getElementById(`${lastCalibData.axis}-spd`).value = lastCalibData.spd.toFixed(5);
            showMessage('Value applied. Please click SAVE ALL to persist.', '#save-message', 5000);
        }},
        { text: 'Apply result & Auto center', class: 'btn-warning', callback: () => {
            document.getElementById(`${lastCalibData.axis}-spd`).value = lastCalibData.spd.toFixed(5);
            sendCommand('autoCenter', { axis: lastCalibData.axis });
            isCalibAutoCenterPending = true; // Đánh dấu đang đợi Auto Center hoàn tất
            showMessage('Moving to Center & Setting Home...', '#save-message', 5000);
        }},
        { text: 'Close', class: 'btn-secondary' }
    ]);
  }

  // Xử lý kết quả Tuning
  if (data.cmd === 'tuningResult') {
    const axisName = data.axis.toUpperCase();
    const scalePct = parseInt(document.getElementById('tuning-scale-pct').value) || 80;
    const avgSgResults = data.avg_sg_results;
    
    if (!avgSgResults || !Array.isArray(avgSgResults)) {
      showModal('⚠️ Error', 'Missing 5-level results from firmware.', [{ text: 'OK' }]);
      return;
    }

    let modalContent = `<strong>${axisName} Tuning Results:</strong><br><br>`;
    modalContent += `<table class="tuning-results-table"><thead><tr><th>Level</th><th>Avg SG</th><th>Crit.(100%)</th><th>SGTHRS (${scalePct}%)</th></tr></thead><tbody>`;

    const finalSgThrsValues = [];

    for (let i = 0; i < avgSgResults.length; i++) {
        const speedLevel = i + 1;
        const avgSG = avgSgResults[i];
        const baseSGTHRS = Math.floor(avgSG > 0 ? avgSG / 2 : 20);
        const finalSGTHRS = Math.floor(baseSGTHRS * (scalePct / 100));
        finalSgThrsValues.push(finalSGTHRS);

        modalContent += `<tr><td>${speedLevel}</td><td>${avgSG}</td><td>${baseSGTHRS}</td><td><strong style="color:var(--success)">${finalSGTHRS}</strong></td></tr>`;
    }
    modalContent += `</tbody></table><br>`;
    modalContent += `<div style="margin-top:10px;">Apply these 5 values to the inputs?</div>`;

    showModal('Tuning Result', 
      modalContent,
      [
        { text: 'Apply to All Levels', class: 'btn-success', callback: () => {
          for(let i=0; i<finalSgThrsValues.length; i++) {
            const inputEl = document.getElementById(`${data.axis}-sg-${i+1}`);
            if (inputEl) inputEl.value = finalSgThrsValues[i];
          }
          showMessage('Sensitivity updated. Click SAVE ALL to store.', '#save-message', 5000);
        }},
        { text: 'Cancel' }
      ]
    );
  }

  // Xử lý kết quả TCOOL Tuning
  if (data.cmd === 'tuningTcoolResult') {
    const axisName = data.axis.toUpperCase();
    const avgResults = data.avg_tstep_results; // Mảng 5 cấp: 2, 4, 8, 16, 32
    const tcoolScalePct = parseInt(document.getElementById('tuning-tcool-scale-pct').value) || 120;
    
    let modalContent = `<strong>${axisName} TCOOLTHRS Tuning Results:</strong><br><br>`;
    modalContent += `<table class="tuning-results-table"><thead><tr><th>Microstep</th><th>Max TSTEP</th><th>Proposed (${tcoolScalePct}%)</th></tr></thead><tbody>`;

    const msLevels = [2, 4, 8, 16, 32];
    const finalTcoolValues = [];

    for (let i = 0; i < avgResults.length; i++) {
        const maxVal = avgResults[i];
        const proposed = Math.floor(maxVal * (tcoolScalePct / 100)); 
        finalTcoolValues.push(proposed);

        modalContent += `<tr><td>MS ${msLevels[i]}</td><td>${maxVal}</td><td><strong style="color:var(--success)">${proposed}</strong></td></tr>`;
    }
    modalContent += `</tbody></table><br><div style="margin-top:10px;">Apply these 5 values to the MS 2,4,8,16,32 inputs?</div>`;

    showModal('TCOOLTHRS Result', modalContent, [
      { text: 'Apply', class: 'btn-success', callback: () => {
        for(let i=0; i<msLevels.length; i++) {
          const inputEl = document.getElementById(`${data.axis}-tcool-${msLevels[i]}`);
          if (inputEl) inputEl.value = finalTcoolValues[i];
        }
        showMessage('TCOOLTHRS updated. Click SAVE ALL.', '#save-message', 5000);
      }},
      { text: 'Cancel' }
    ]);
  }

  if (data.alert) {
    showModal('System Message', data.alert, [{ text: 'OK', class: 'btn-primary' }]);
  }
  if (data.pos_az !== undefined) {
    const el = document.getElementById('pos-az');
    if (el) el.textContent = toDMS(data.pos_az);
    const homeEl = document.getElementById('home-az-current');
    if (homeEl) homeEl.textContent = toDMS(data.pos_az);
  }
  if (data.pos_alt !== undefined) {
    const el = document.getElementById('pos-alt');
    if (el) el.textContent = toDMS(data.pos_alt);
    const homeEl = document.getElementById('home-alt-current');
    if (homeEl) homeEl.textContent = toDMS(data.pos_alt);
  }
  if (data.align_moved_az !== undefined) {
    const el = document.getElementById('align-moved-az');
    if (el) el.textContent = toDMS(data.align_moved_az);
  }
  if (data.align_moved_alt !== undefined) {
    const el = document.getElementById('align-moved-alt');
    if (el) el.textContent = toDMS(data.align_moved_alt);
  }
  if (data.steps_az !== undefined) {
    const el = document.getElementById('steps-az');
    if (el) el.textContent = data.steps_az;
  }
  if (data.steps_alt !== undefined) {
    const el = document.getElementById('steps-alt');
    if (el) el.textContent = data.steps_alt;
  }
  if (data.out_speed_az !== undefined) {
    const el = document.getElementById('out-speed-az');
    if (el) el.textContent = data.out_speed_az.toFixed(4);
  }
  if (data.out_speed_alt !== undefined) {
    const el = document.getElementById('out-speed-alt');
    if (el) el.textContent = data.out_speed_alt.toFixed(4);
  }
  if (data.speed_az !== undefined) {
    const el = document.getElementById('speed-az');
    if (el) el.textContent = data.speed_az.toFixed(3);
  }
  if (data.speed_alt !== undefined) {
    const el = document.getElementById('speed-alt');
    if (el) el.textContent = data.speed_alt.toFixed(3);
  }
  if (data.homed !== undefined) {
    isSystemHomed = data.homed; // Cập nhật biến toàn cục
    document.getElementById('homed-status').innerHTML = '🏠 Homed: <strong>' + (data.homed ? 'Yes' : 'No') + '</strong>';
    
    // Kiểm tra nếu vừa hoàn thành Auto Center từ quy trình Calib
    if (isSystemHomed && isCalibAutoCenterPending) {
      isCalibAutoCenterPending = false; // Reset cờ
      showModal(
        'Calibration & Set Home',
        'Calibration & set home COMPLETED.',
        [
          { 
            text: 'SET HOME, SAVE & REBOOT NOW', 
            class: 'btn-success', 
            callback: () => {
              sendCommand('setHome', {}); // Đảm bảo gửi lệnh Set Home
              const config = collectConfig();
              sendCommand('saveConfig', config);
              showMessage('Setting Home & Saving...', '#save-message', 2000);
              // Đợi 1 chút để lệnh saveConfig được xử lý rồi mới gửi lệnh reboot
              setTimeout(() => {
                sendCommand('reboot', {});
                setRebootingStatus();
                showMessage('System Rebooting...', '#save-message', 10000);
                setTimeout(() => location.reload(), 5000);
              }, 1000);
            }
          },
          { text: 'CANCEL', class: 'btn-secondary' } // Chỉ đóng modal, kết quả đã được điền từ bước trước
        ]
      );
    }
  }
  
  if (data.sys_status !== undefined) {
    if (data.sys_status === 'REBOOTING') isRebooting = true;
    if (isRebooting && data.sys_status !== 'REBOOTING') {
      // Đang chờ reboot: giữ nguyên trạng thái REBOOTING, không để bị ghi đè
    } else {
      const el = document.getElementById('system-status');
      if (el) {
        el.textContent = data.sys_status;
        el.classList.add('font-bold');
        
        // Cập nhật màu sắc trạng thái
        el.classList.remove('status-text-success', 'status-text-danger', 'status-text-warning');
        let colorClass = 'status-text-success';
        if (data.sys_status === 'ERROR') colorClass = 'status-text-danger';
        else if (data.sys_status === 'REBOOTING') colorClass = 'status-text-success';
        else if (data.sys_status !== 'READY') colorClass = 'status-text-warning';
        el.classList.add(colorClass);

        // Khóa/Mở khóa các nút điều khiển dựa trên trạng thái lỗi
        hasSystemError = (data.sys_status === 'ERROR');
        setSystemLocked(hasSystemError || isSystemCalibrating);
      }
    }
  }

  // Cập nhật trạng thái Calib để khóa nút
  if (data.isCalibrating !== undefined) {
    isSystemCalibrating = data.isCalibrating;
    setSystemLocked(hasSystemError || isSystemCalibrating);
  }
  
  // Cập nhật thông tin phiên bản từ Server
  if (data.fw_ver !== undefined) {
    // Lưu version để so sánh nhưng chỉ hiển thị một dòng Firmware x.x.x trên header.
    currentFwVer = extractVersion(data.fw_ver);
    const el = document.getElementById('display-fw-ver');
    if (el) el.textContent = `Firmware ${currentFwVer}`;
  }

  if (data.rssi !== undefined) {
    updateWifiIcon(data.rssi);
  }
  
  if (data.wifi_scan !== undefined) {
    renderWifiList(data.wifi_scan);
  }

  // Cập nhật biểu đồ StallGuard
  if (data.sg_az !== undefined && data.sg_alt !== undefined) {
    const isRunning = (data.running !== undefined) ? data.running : true;
    if (!hasSystemError && isRunning) updateChart(data.sg_az, data.sg_alt, data.cs_az, data.cs_alt, data.tstep_az, data.tstep_alt);
  }

  // Cập nhật đèn báo DIAG
  if (data.diag_az !== undefined) {
    const dot = document.getElementById('diag-az-status');
    if (dot) {
      if (data.diag_az) dot.classList.add('active'); else dot.classList.remove('active');
    }
  }
  if (data.diag_alt !== undefined) {
    const dot = document.getElementById('diag-alt-status');
    if (dot) {
      if (data.diag_alt) dot.classList.add('active'); else dot.classList.remove('active');
    }
  }
  
  // Xử lý hiển thị trạng thái Homing... / Completed
  if (data.isAutoMoving !== undefined) {
    const statusEl = document.getElementById('homing-process-status');
    if (statusEl) {
      if (data.isAutoMoving) {
        // Đang chạy
        statusEl.textContent = "🔄 Homing...";
        statusEl.className = "homing-status homing-running";
        wasAutoMoving = true;
      } else if (wasAutoMoving) {
        // Vừa chạy xong (chuyển từ true -> false)
        statusEl.textContent = isSystemHomed ? "✅ Homing Completed" : "✅ Auto Center Done";
        statusEl.className = "homing-status homing-completed";
        wasAutoMoving = false;
        // Ẩn dòng Completed sau 3 giây
        setTimeout(() => { if(statusEl.textContent.includes("Completed") || statusEl.textContent.includes("Done")) statusEl.style.display = 'none'; }, 3000);
        
        // Reset cờ pending nếu chạy single axis (không kích hoạt popup Homed)
        if (isCalibAutoCenterPending) {
            isCalibAutoCenterPending = false;
            if (!isSystemHomed) showMessage('Auto Center Completed.', '#save-message', 3000);
        }
      }
    }
  }
  if (data.speedLevel !== undefined) {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.speed-btn[data-level="${data.speedLevel}"]`);
    if (btn) btn.classList.add('active');
  }
  if (data.ip !== undefined) {
    const ipEl = document.getElementById('wifi-ip');
    if (ipEl) {
      if (ipEl.tagName === 'INPUT') ipEl.value = data.ip;
      else ipEl.textContent = data.ip;
    }
  }
  if (data.ssid !== undefined) {
    const el = document.getElementById('wifi-ssid');
    if (el) el.value = data.ssid;
  }
  if (data.pass !== undefined) {
    const el = document.getElementById('wifi-pass');
    if (el) el.value = data.pass;
  }
  // Cập nhật AP Settings
  if (data.wifi_ap !== undefined) {
    if (data.wifi_ap.ssid !== undefined) document.getElementById('ap-ssid').value = data.wifi_ap.ssid;
    if (data.wifi_ap.pass !== undefined) document.getElementById('ap-pass').value = data.wifi_ap.pass;
    if (data.wifi_ap.ip !== undefined) document.getElementById('ap-ip').value = data.wifi_ap.ip;
    if (data.wifi_ap.subnet !== undefined) document.getElementById('ap-subnet').value = data.wifi_ap.subnet;
  }
  // Cập nhật Soft Limits lên giao diện
  if (data.limits !== undefined) {
    if (data.limits.az_min !== undefined) document.getElementById('limit-az-min').value = data.limits.az_min;
    if (data.limits.az_max !== undefined) document.getElementById('limit-az-max').value = data.limits.az_max;
    if (data.limits.alt_min !== undefined) document.getElementById('limit-alt-min').value = data.limits.alt_min;
    if (data.limits.alt_max !== undefined) document.getElementById('limit-alt-max').value = data.limits.alt_max;
    if (data.limits.enable_softlimit !== undefined) {
      const cb = document.getElementById('enable-softlimit');
      if (cb) cb.checked = data.limits.enable_softlimit;
    }
    normalizeSoftLimitInputs();
  }
  // Cập nhật Motor settings
  if (data.motor !== undefined) {
    if (data.motor.az_run_ma !== undefined) document.getElementById('az-current-run').value = data.motor.az_run_ma;
    if (data.motor.az_hold_ma !== undefined) document.getElementById('az-current-hold').value = data.motor.az_hold_ma;
    if (data.motor.az_boost_pct !== undefined) document.getElementById('az-boost-pct').value = data.motor.az_boost_pct;
    if (data.motor.az_soft_cs_pct !== undefined && document.getElementById('az-soft-cs-pct')) document.getElementById('az-soft-cs-pct').value = data.motor.az_soft_cs_pct;
    if (data.motor.az_microsteps !== undefined) {
      const el = document.getElementById('az-microsteps');
      el.value = data.motor.az_microsteps;
      el.dataset.prev = data.motor.az_microsteps; // Lưu lại phiên bản hiện tại từ server
    }
    if (data.motor.az_accel !== undefined) document.getElementById('az-accel').value = data.motor.az_accel;
    if (data.motor.az_decel !== undefined) document.getElementById('az-decel').value = data.motor.az_decel;
    if (data.motor.az_spd !== undefined) document.getElementById('az-spd').value = data.motor.az_spd;
    if (data.motor.az_reverse !== undefined) document.getElementById('az-reverse').checked = data.motor.az_reverse;
    
    if (data.motor.alt_run_ma !== undefined) document.getElementById('alt-current-run').value = data.motor.alt_run_ma;
    if (data.motor.alt_hold_ma !== undefined) document.getElementById('alt-current-hold').value = data.motor.alt_hold_ma;
    if (data.motor.alt_boost_pct !== undefined) document.getElementById('alt-boost-pct').value = data.motor.alt_boost_pct;
    if (data.motor.alt_soft_cs_pct !== undefined && document.getElementById('alt-soft-cs-pct')) document.getElementById('alt-soft-cs-pct').value = data.motor.alt_soft_cs_pct;
    if (data.motor.alt_microsteps !== undefined) {
      const el = document.getElementById('alt-microsteps');
      el.value = data.motor.alt_microsteps;
      el.dataset.prev = data.motor.alt_microsteps;
    }
    if (data.motor.max_speed !== undefined) document.getElementById('max-speed').value = data.motor.max_speed;
    if (data.motor.alt_accel !== undefined) document.getElementById('alt-accel').value = data.motor.alt_accel;
    if (data.motor.alt_decel !== undefined) document.getElementById('alt-decel').value = data.motor.alt_decel;
    if (data.motor.alt_spd !== undefined) document.getElementById('alt-spd').value = data.motor.alt_spd;
    if (data.motor.alt_reverse !== undefined) document.getElementById('alt-reverse').checked = data.motor.alt_reverse;
    
    if (data.motor.az_spread_cycle !== undefined) document.getElementById(data.motor.az_spread_cycle ? 'az-mode-spreadcycle' : 'az-mode-stealthchop').checked = true;
    if (data.motor.alt_spread_cycle !== undefined) document.getElementById(data.motor.alt_spread_cycle ? 'alt-mode-spreadcycle' : 'alt-mode-stealthchop').checked = true;
    if (data.motor.show_steps !== undefined) {
      document.getElementById('show-steps').checked = data.motor.show_steps;
      toggleStepsDisplay(data.motor.show_steps);
    }
    if (data.motor.az_sg_thrs !== undefined) {
      data.motor.az_sg_thrs.forEach((val, i) => { const el = document.getElementById(`az-sg-${i+1}`); if(el) el.value = val; });
    }
    if (data.motor.alt_sg_thrs !== undefined) {
      data.motor.alt_sg_thrs.forEach((val, i) => { const el = document.getElementById(`alt-sg-${i+1}`); if(el) el.value = val; });
    }
    if (data.motor.az_tcool_presets !== undefined) {
      const msteps = [2, 4, 8, 16, 32, 64];
      data.motor.az_tcool_presets.forEach((val, i) => {
        const el = document.getElementById(`az-tcool-${msteps[i]}`);
        if (el) el.value = val;
      });
    }
    if (data.motor.alt_tcool_presets !== undefined) {
      const msteps = [2, 4, 8, 16, 32, 64];
      data.motor.alt_tcool_presets.forEach((val, i) => {
        const el = document.getElementById(`alt-tcool-${msteps[i]}`);
        if (el) el.value = val;
      });
    }
    if (data.motor.stall_time !== undefined) document.getElementById('stall-time').value = data.motor.stall_time;
    if (data.motor.escape_rotations !== undefined) document.getElementById('escape-rotations').value = data.motor.escape_rotations;
    if (data.motor.enable_hardlimit !== undefined) document.getElementById('enable-hardlimit').checked = data.motor.enable_hardlimit;
    if (data.motor.show_hardlimit_monitor !== undefined) {
      const cb = document.getElementById('show-hardlimit-monitor');
      if (cb) {
        cb.checked = data.motor.show_hardlimit_monitor;
        toggleMonitorPanel(data.motor.show_hardlimit_monitor);
      }
    }
    if (data.motor.swap_az_alt !== undefined) {
      const sa = document.getElementById('swap-az-alt');
      if (sa) sa.checked = data.motor.swap_az_alt;
    }
    if (data.serial !== undefined) {
      const sMap = { baud: 'serial-baud', databits: 'serial-databits', stopbits: 'serial-stopbits', parity: 'serial-parity' };
      for (const k in sMap) {
        if (data.serial[k] !== undefined) {
          const el = document.getElementById(sMap[k]);
          if (el) el.value = String(data.serial[k]);
        }
      }
      if (data.serial.watchdog !== undefined) {
        const cw = document.getElementById('enable-comm-watchdog');
        if (cw) cw.checked = data.serial.watchdog;
      }
      if (data.serial.log !== undefined) {
        const sl = document.getElementById('toggle-serial-log-btn');
        if (sl) {
          sl.checked = data.serial.log;
          const panel = document.getElementById('serial-log-panel');
          if (panel) panel.style.display = data.serial.log ? 'block' : 'none';
        }
      }
    }
    isUpdatingFromWS = false;
  }

  // Cập nhật Backlash settings
  if (data.backlash !== undefined) {
    if (data.backlash.enable !== undefined) {
      const cb = document.getElementById('enable-backlash');
      if (cb) cb.checked = data.backlash.enable;
    }
    if (data.backlash.az_steps !== undefined) {
      const az = document.getElementById('backlash-az');
      if (az) az.value = data.backlash.az_steps;
    }
    if (data.backlash.alt_steps !== undefined) {
      const alt = document.getElementById('backlash-alt');
      if (alt) alt.value = data.backlash.alt_steps;
    }
    if (data.backlash.overshoot !== undefined) {
      const os = document.getElementById('enable-overshoot');
      if (os) os.checked = data.backlash.overshoot;
    }
    if (data.backlash.overshoot_d !== undefined) {
      const d = document.getElementById('overshoot-deg');
      if (d) d.value = data.backlash.overshoot_d;
    }
    if (data.backlash.overshoot_m !== undefined) {
      const m = document.getElementById('overshoot-min');
      if (m) m.value = data.backlash.overshoot_m;
    }
    if (data.backlash.overshoot_s !== undefined) {
      const s = document.getElementById('overshoot-sec');
      if (s) s.value = data.backlash.overshoot_s;
    }
    if (data.backlash.overshoot_up !== undefined) {
      const up = document.getElementById('overshoot-up');
      if (up) up.checked = data.backlash.overshoot_up;
    }
    if (data.backlash.overshoot_down !== undefined) {
      const dn = document.getElementById('overshoot-down');
      if (dn) dn.checked = data.backlash.overshoot_down;
    }
  }

  // Cập nhật Alignment Params
  if (data.align !== undefined) {
    if (data.align.az !== undefined) {
      document.getElementById('az-deg').value = data.align.az.d;
      document.getElementById('az-min').value = data.align.az.m;
      document.getElementById('az-sec').value = data.align.az.s;
      document.getElementById('az-dir').checked = data.align.az.dir;
    }
    if (data.align.alt !== undefined) {
      document.getElementById('alt-deg').value = data.align.alt.d;
      document.getElementById('alt-min').value = data.align.alt.m;
      document.getElementById('alt-sec').value = data.align.alt.s;
      document.getElementById('alt-dir').checked = data.align.alt.dir;
    }
  }
  
  // Cập nhật Relative Settings từ Firmware
  if (data.relative !== undefined) {
    isUpdatingFromWS = true; // Bật cờ chặn
    const toggle = document.getElementById('move-mode-toggle');
    if (toggle) {
      toggle.checked = data.relative.mode;
      // Trigger change event manually to update UI visibility
      toggle.dispatchEvent(new Event('change'));
    }
    if (data.relative.d !== undefined) document.getElementById('rel-d').value = data.relative.d;
    if (data.relative.m !== undefined) document.getElementById('rel-m').value = data.relative.m;
    if (data.relative.s !== undefined) document.getElementById('rel-s').value = data.relative.s;
    updateStepperDisplay('rel-d');
    updateStepperDisplay('rel-m');
    updateStepperDisplay('rel-s');
    isUpdatingFromWS = false; // Tắt cờ chặn
  }

  // Xử lý tiến độ OTA
  if (data.ota_progress !== undefined) {
    const percent = data.ota_progress;
    if (otaMode === 'ota') {
      const currentStep = otaPlan?.steps?.[otaCurrentStepIndex];
      const stepLabel = currentStep ? `Installing ${currentStep.type} (${otaCurrentStepIndex + 1}/${otaPlan.steps.length})...` : 'Installing update...';
      updateOtaInstallOverlay(percent, stepLabel);
    }
  }

  if (data.ota_done) {
    const doneType = data.ota_type || 'update';

    if (data.reboot_after) {
      if (otaMode === 'ota') {
        showOtaInstallSuccessCountdown(3);
      }
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } else {
      if (otaMode === 'ota') {
        updateOtaInstallOverlay(100, `Completed ${doneType}. Starting next package...`);
      }
      setTimeout(() => {
        startNextPlannedOtaStep();
      }, 600);
    }
  }

  // Xử lý khi OTA thất bại
  if (data.ota_status === "FAILED") {
    hideOtaProgressUI();
    if (otaMode === 'ota') {
      updateOtaInstallOverlay(0, 'Installing failed. Please retry.');
      setTimeout(() => {
        hideOtaInstallOverlay();
      }, 1500);
    }
    otaPlan = null;
    otaCurrentStepIndex = -1;
  }

  // Xử lý log từ server
  if (data.log !== undefined) {
    appendLog(data.log);
  }

  // Xử lý trạng thái khóa (PC Serial đang điều khiển)
  if (data.serial_locked !== undefined) {
    applySystemLock(!!data.serial_locked);
  }

  // Xử lý log Serial TX/RX
  if (data.serial_log !== undefined) {
    appendSerialLog(data.serial_log.dir, data.serial_log.msg);
  }

  // Cập nhật danh sách client
  if (data.clients !== undefined) {
    const listEl = document.getElementById('clients-list');
    if (listEl) {
      if (data.clients.length === 0) {
        listEl.innerHTML = '<div class="clients-empty">No clients connected.</div>';
      } else {
        listEl.innerHTML = ''; // Clear old list
        data.clients.forEach(client => {
          const item = document.createElement('div');
          item.className = 'client-item';
          item.innerHTML = `<span class="client-name">${client.name || 'Unknown'}</span><span class="client-ip">${client.ip}</span><span class="client-mac">${client.mac}</span>`;
          listEl.appendChild(item);
        });
      }
    }
  }
}

// ===== WIFI ICON UPDATE =====
function updateWifiIcon(rssi) {
  const el = document.getElementById('connection-status');
  if (!el) return;

  el.classList.remove('wifi-text-success', 'wifi-text-warning', 'wifi-text-danger');

  // Mất kết nối (RSSI = -1000 hoặc WS đóng)
  if (rssi <= -100) {
    el.textContent = '❌'; // Icon mất kết nối
    el.title = 'Disconnected';
    el.classList.add('wifi-text-danger');
    return;
  }

  // Hiển thị mức sóng
  let icon = '📶';
  let colorClass = 'wifi-text-success';

  if (rssi > -55) {       // Rất tốt (> -55dBm)
    colorClass = 'wifi-text-success';
  } else if (rssi > -70) { // Khá (> -70dBm)
    colorClass = 'wifi-text-warning';
  } else {                 // Yếu (< -70dBm)
    colorClass = 'wifi-text-danger';
  }

  el.textContent = icon;
  el.classList.add(colorClass);
  el.title = `Signal: ${rssi} dBm`;
}

function toggleStepsDisplay(show) {
  const displays = document.querySelectorAll('.steps-display');
  displays.forEach(el => el.style.display = show ? 'block' : 'none');
}

function toggleMonitorPanel(show) {
  const panel = document.querySelector('.monitor-panel');
  if (panel) panel.style.display = show ? 'block' : 'none';
}

// ===== SYSTEM LOCK FUNCTION =====
function setSystemLocked(isLocked) {
  const buttonsToLock = [
    'btn-up', 'btn-down', 'btn-left', 'btn-right',
    'align-btn', 'align-az-btn', 'align-alt-btn',
    'return-home-btn', 'set-home-btn', 'reset-home-btn',
    'save-az-btn', 'save-alt-btn'
  ];
  
  buttonsToLock.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = isLocked;
      if (isLocked) btn.classList.add('ui-locked');
      else btn.classList.remove('ui-locked');
    }
  });
}

// ===== TAB SWITCHING =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;
    
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Remove active from all buttons
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
    });
    
    // Show selected tab and mark button as active
    document.getElementById(tabName + '-tab').classList.add('active');
    btn.classList.add('active');
  });
});

// ===== SPEED LEVEL SELECTION =====
document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active from all
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    // Add active to clicked
    btn.classList.add('active');
    // Store level
    localStorage.setItem('speedLevel', btn.dataset.level);
    sendCommand('speedLevel', { level: parseInt(btn.dataset.level) });
  });
});


// ===== HELPER: COLLECT CONFIG =====
function collectConfig() {
  return {
    limits: {
      enable_softlimit: document.getElementById('enable-softlimit') ? document.getElementById('enable-softlimit').checked : true,
      az_min: parseFloat(document.getElementById('limit-az-min').value),
      az_max: parseFloat(document.getElementById('limit-az-max').value),
      alt_min: parseFloat(document.getElementById('limit-alt-min').value),
      alt_max: parseFloat(document.getElementById('limit-alt-max').value)
    },
    motor: {
      az_run_ma: parseInt(document.getElementById('az-current-run').value),
      az_hold_ma: parseInt(document.getElementById('az-current-hold').value),
      az_boost_pct: parseInt(document.getElementById('az-boost-pct').value) || 120,
      az_soft_cs_pct: document.getElementById('az-soft-cs-pct') ? (parseInt(document.getElementById('az-soft-cs-pct').value) || 70) : 70,
      az_microsteps: parseInt(document.getElementById('az-microsteps').value),
      az_accel: parseInt(document.getElementById('az-accel').value),
      az_decel: parseInt(document.getElementById('az-decel').value),
      az_spd: parseFloat(document.getElementById('az-spd').value),
      az_reverse: document.getElementById('az-reverse').checked,
      alt_run_ma: parseInt(document.getElementById('alt-current-run').value),
      alt_hold_ma: parseInt(document.getElementById('alt-current-hold').value),
      alt_boost_pct: parseInt(document.getElementById('alt-boost-pct').value) || 120,
      alt_soft_cs_pct: document.getElementById('alt-soft-cs-pct') ? (parseInt(document.getElementById('alt-soft-cs-pct').value) || 70) : 70,
      alt_microsteps: parseInt(document.getElementById('alt-microsteps').value),
      max_speed: parseFloat(document.getElementById('max-speed').value) || 400.0,
      alt_accel: parseInt(document.getElementById('alt-accel').value),
      alt_decel: parseInt(document.getElementById('alt-decel').value),
      alt_spd: parseFloat(document.getElementById('alt-spd').value),
      alt_reverse: document.getElementById('alt-reverse').checked,
      az_spread_cycle: document.getElementById('az-mode-spreadcycle').checked,
      alt_spread_cycle: document.getElementById('alt-mode-spreadcycle').checked,
      show_steps: document.getElementById('show-steps').checked,
      az_sg_thrs: Array.from({length: 5}, (_, i) => parseInt(document.getElementById(`az-sg-${i+1}`).value) || 110),
      alt_sg_thrs: Array.from({length: 5}, (_, i) => parseInt(document.getElementById(`alt-sg-${i+1}`).value) || 110),
      az_tcool_presets: [2, 4, 8, 16, 32, 64].map(ms => parseInt(document.getElementById(`az-tcool-${ms}`).value) || 0),
      alt_tcool_presets: [2, 4, 8, 16, 32, 64].map(ms => parseInt(document.getElementById(`alt-tcool-${ms}`).value) || 0),
      stall_time: parseInt(document.getElementById('stall-time').value),
      escape_rotations: parseInt(document.getElementById('escape-rotations').value),
      enable_hardlimit: document.getElementById('enable-hardlimit').checked,
      show_hardlimit_monitor: document.getElementById('show-hardlimit-monitor').checked,
      swap_az_alt: document.getElementById('swap-az-alt') ? document.getElementById('swap-az-alt').checked : false
    },
    serial: {
      baud: parseInt(document.getElementById('serial-baud').value) || 115200,
      databits: parseInt(document.getElementById('serial-databits').value) || 8,
      stopbits: parseFloat(document.getElementById('serial-stopbits').value) || 1,
      parity: parseInt(document.getElementById('serial-parity').value) || 0,
      watchdog: document.getElementById('enable-comm-watchdog') ? document.getElementById('enable-comm-watchdog').checked : true,
      log: document.getElementById('toggle-serial-log-btn') ? document.getElementById('toggle-serial-log-btn').checked : false
    },
    backlash: {
      enable: document.getElementById('enable-backlash').checked,
      az_steps: parseInt(document.getElementById('backlash-az').value),
      alt_steps: parseInt(document.getElementById('backlash-alt').value),
      overshoot: document.getElementById('enable-overshoot').checked,
      overshoot_d: clampInt(document.getElementById('overshoot-deg').value, 0, 10),
      overshoot_m: clampInt(document.getElementById('overshoot-min').value, 0, 59),
      overshoot_s: clampInt(document.getElementById('overshoot-sec').value, 0, 59),
      overshoot_up: document.getElementById('overshoot-up').checked,
      overshoot_down: document.getElementById('overshoot-down').checked
    },
    relative: {
      mode: document.getElementById('move-mode-toggle').checked,
      d: parseInt(document.getElementById('rel-d').value) || 0,
      m: parseInt(document.getElementById('rel-m').value) || 0,
      s: parseInt(document.getElementById('rel-s').value) || 0
    },
    wifi: {
      ssid: (document.getElementById('wifi-ssid') && document.getElementById('wifi-ssid').value) || '',
      pass: (document.getElementById('wifi-pass') && document.getElementById('wifi-pass').value) || ''
    },
    wifi_ap: {
      ssid: document.getElementById('ap-ssid').value,
      pass: document.getElementById('ap-pass').value,
      ip: document.getElementById('ap-ip').value,
      subnet: document.getElementById('ap-subnet').value,
    }
  };
}

// ===== CONFIG APPLY (no reboot, no FRAM save) =====
function applyConfigOnly() {
  if (!validateSoftLimitsBeforeSave()) return;
  const config = collectConfig();
  sendCommand('applyConfig', config);
  toggleStepsDisplay(config.motor.show_steps);
  toggleMonitorPanel(config.motor.show_hardlimit_monitor);
  showMessage('⚡ Settings applied (not saved). Reboot to discard.', '#save-message', 4000);
}

const applyBtn = document.getElementById('apply-btn');
if (applyBtn) applyBtn.addEventListener('click', applyConfigOnly);

const rebootBtn = document.getElementById('reboot-btn');
if (rebootBtn) rebootBtn.addEventListener('click', () => {
  showModal('Reboot Device', 'Reboot ESP32 now? Any unapplied or unsaved changes will be discarded.', [
    { text: 'Reboot', class: 'btn-danger', callback: () => { sendCommand('reboot', {}); } },
    { text: 'Cancel', class: 'btn-secondary' }
  ]);
});

// ===== CONFIG SAVE =====
const saveAllBtn = document.getElementById('save-all-btn');
if(saveAllBtn) saveAllBtn.addEventListener('click', () => {
  if (!validateSoftLimitsBeforeSave()) {
    return;
  }
  const config = collectConfig();
  
  sendCommand('saveConfig', config);
  setRebootingStatus();
  toggleStepsDisplay(config.motor.show_steps); // Cập nhật hiển thị ngay lập tức
  toggleMonitorPanel(config.motor.show_hardlimit_monitor);
  
  let countdown = 5;
  const msgEl = document.querySelector('#save-message');
  if(msgEl) {
    msgEl.style.display = 'block';
    msgEl.textContent = `Settings saved. Refreshing in ${countdown}s...`;
    
    const interval = setInterval(() => {
      countdown--;
      if(countdown <= 0) {
        clearInterval(interval);
        location.reload();
      } else {
        msgEl.textContent = `Settings saved. Refreshing in ${countdown}s...`;
      }
    }, 1000);
  }
});

bindSoftLimitInputGuards();

// ===== CALIBRATION CHECK HELPER =====
function performCalibrationCheck(callback) {
  const hlCheckbox = document.getElementById('enable-hardlimit');
  if (hlCheckbox && !hlCheckbox.checked) {
    showModal(
      'Enable Hard Limit?',
      'You must enable hardlimit first. Check it now & reboot?',
      [
        { 
          text: 'OK', 
          class: 'btn-primary', 
          callback: () => {
            hlCheckbox.checked = true;
            const config = collectConfig();
            sendCommand('saveConfig', config);
            setRebootingStatus();
            
            // Hiển thị đếm ngược Reboot giống nút Save All
            let countdown = 5;
            const msgEl = document.querySelector('#save-message');
            if(msgEl) {
              msgEl.style.display = 'block';
              msgEl.textContent = `Hardlimit Enabled. Rebooting in ${countdown}s...`;
              
              const interval = setInterval(() => {
                countdown--;
                if(countdown <= 0) {
                  clearInterval(interval);
                  location.reload();
                } else {
                  msgEl.textContent = `Hardlimit Enabled. Rebooting in ${countdown}s...`;
                }
              }, 1000);
            }
            // Không gọi callback() nữa vì hệ thống sẽ reboot
          }
        },
        { text: 'Cancel' }
      ]
    );
  } else {
    callback();
  }
}

// ===== LIVE UI UPDATES =====
const showStepsCheckbox = document.getElementById('show-steps');
if(showStepsCheckbox) {
  showStepsCheckbox.addEventListener('change', (e) => {
    toggleStepsDisplay(e.target.checked);
  });
}

function getRelativeDistance() {
  const d = parseInt(document.getElementById('rel-d').value) || 0;
  const m = parseInt(document.getElementById('rel-m').value) || 0;
  const s = parseInt(document.getElementById('rel-s').value) || 0;
  
  // Calculate total degrees
  return d + (m / 60.0) + (s / 3600.0);
}

// ===== MOVEMENT BUTTONS =====
const moveButtons = {
  'btn-up': { axis: 'alt', dir: 1 },
  'btn-down': { axis: 'alt', dir: -1 },
  'btn-left': { axis: 'az', dir: -1 },
  'btn-right': { axis: 'az', dir: 1 },
};

Object.keys(moveButtons).forEach(btnId => {
  const btn = document.getElementById(btnId);
  if(!btn) return;
  const { axis, dir } = moveButtons[btnId];
  
  let isPressed = false;

  btn.addEventListener('mousedown', () => {
    if (isRelativeMode) return; // Ignore hold in relative mode
    isPressed = true;
    const active = document.querySelector('.speed-btn.active');
    const speed = active ? active.dataset.level : '3';
    sendCommand('move', { axis, direction: dir, speed });
  });
  
  btn.addEventListener('mouseup', () => {
    if (isRelativeMode) return;
    if (isPressed) {
      isPressed = false;
      sendCommand('stop', {});
    }
  });
  
  // Dừng động cơ khi trượt chuột ra khỏi nút (coi như nhả chuột)
  btn.addEventListener('mouseleave', () => {
    if (isRelativeMode) return;
    if (isPressed) {
      isPressed = false;
      sendCommand('stop', {});
    }
  });
  
  btn.addEventListener('touchstart', (e) => {
    if (e.cancelable) e.preventDefault(); 
    if (isRelativeMode) return; // Ignore hold in relative mode
    const active = document.querySelector('.speed-btn.active');
    const speed = active ? active.dataset.level : '3';
    sendCommand('move', { axis, direction: dir, speed });
  });
  
  btn.addEventListener('touchend', (e) => {
    if (e.cancelable) e.preventDefault(); // Ngăn chặn hành động mặc định
    if (isRelativeMode) return;
    sendCommand('stop', {});
  });

  // Handle Relative Move (Click)
  btn.addEventListener('click', () => {
    if (!isRelativeMode) return;
    const angle = getRelativeDistance();
    const active = document.querySelector('.speed-btn.active');
    const speed = active ? active.dataset.level : '3';
    sendCommand('moveRelative', { axis, direction: dir, angle: angle, speed: speed });
  });
});

// Stop button
const btnStop = document.getElementById('btn-stop');
if(btnStop) btnStop.addEventListener('click', () => { sendCommand('stop', {}); });

// Force Stop button
const btnForceStop = document.getElementById('btn-force-stop');
if(btnForceStop) btnForceStop.addEventListener('click', () => { sendCommand('forceStop', {}); });

// ===== HOME BUTTONS =====
const setHomeBtn = document.getElementById('set-home-btn');
if(setHomeBtn) setHomeBtn.addEventListener('click', () => {
  showModal(
    'Confirm Set Home',
    'Set home position at current location?',
    [
      { text: 'Yes, Set Home', class: 'btn-warning', callback: () => {
        sendCommand('setHome', {});
        showMessage('Home position set!', '#save-message', 2000);
      }},
      { text: 'Cancel', class: 'btn-secondary' }
    ]
  );
});

const returnHomeBtn = document.getElementById('return-home-btn');
if(returnHomeBtn) returnHomeBtn.addEventListener('click', () => {
  // Kiểm tra trạng thái lỗi trước khi gửi lệnh
  if (hasSystemError) {
    showModal('Action Blocked', 'System is in an error state. Please reset the error first.', [{ text: 'OK', class: 'btn-danger' }]);
    return;
  }
  // Kiểm tra nếu chưa Set Home thì báo lỗi và không gửi lệnh
  if (!isSystemHomed) {
    showModal('Action Blocked', 'You have not set a home position yet. Please use "SET HOME HERE" first.', [{ text: 'OK', class: 'btn-warning' }]);
    return;
  }
  sendCommand('returnHome', {});
  showMessage('Returning to home...', '#save-message', 3000);
});

const resetHomeBtn = document.getElementById('reset-home-btn');
if(resetHomeBtn) resetHomeBtn.addEventListener('click', () => {
  showModal(
    'Confirm Reset Home', 
    'Are you sure you want to reset the home position? The equipment must be manually repositioned afterwards.', 
    [
      { text: 'Yes, Reset Home', class: 'btn-danger', callback: () => {
        sendCommand('resetHome', {});
        showMessage('Home reset. Please reposition equipment.', '#save-message', 3000);
      }},
      { text: 'Cancel', class: 'btn-secondary' }
    ]);
});

// ===== HELPER: GET ERROR VALUE =====
function getErrorValue(prefix, dirId) {
  const d = Math.abs(parseInt(document.getElementById(prefix + '-deg').value) || 0);
  const m = Math.abs(parseInt(document.getElementById(prefix + '-min').value) || 0);
  const s = Math.abs(parseFloat(document.getElementById(prefix + '-sec').value) || 0);
  
  // Tính tổng arcseconds: (Độ * 3600) + (Phút * 60) + Giây (bao gồm phần thập phân)
  let totalArcsec = (Math.abs(d) * 3600) + (Math.abs(m) * 60) + Math.abs(s);
  
  // Xử lý hướng (Toggle Switch)
  // Checked = Right/Up (Dương)
  // Unchecked = Left/Down (Âm)
  const isPositive = document.getElementById(dirId).checked;
  if (!isPositive) {
    totalArcsec = -totalArcsec;
  }
  
  return totalArcsec;
}

// ===== SAVE ALIGNMENT SETTINGS TO FRAM =====
function saveAlignSettings() {
  if (isUpdatingFromWS) return; // Không lưu nếu đang được render từ ESP32
  const config = {
    align: {
      az: {
        d: parseInt(document.getElementById('az-deg').value) || 0,
        m: parseInt(document.getElementById('az-min').value) || 0,
        s: parseFloat(document.getElementById('az-sec').value) || 0,
        dir: document.getElementById('az-dir').checked
      },
      alt: {
        d: parseInt(document.getElementById('alt-deg').value) || 0,
        m: parseInt(document.getElementById('alt-min').value) || 0,
        s: parseFloat(document.getElementById('alt-sec').value) || 0,
        dir: document.getElementById('alt-dir').checked
      }
    }
  };
  sendCommand('saveConfig', config);
}

['az-deg', 'az-min', 'az-sec', 'az-dir', 'alt-deg', 'alt-min', 'alt-sec', 'alt-dir'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', saveAlignSettings); // Lắng nghe để lưu tự động
});


// ===== ALIGNMENT =====
// Align All Button
const alignBtn = document.getElementById('align-btn');
if(alignBtn) alignBtn.addEventListener('click', () => {
  // Kiểm tra trạng thái lỗi
  if (hasSystemError) {
    showModal('Action Blocked', 'System is in an error state. Please reset the error first.', [{ text: 'OK', class: 'btn-danger' }]);
    return;
  }
  if (!isSystemHomed) { 
    showModal('Action Blocked', 'You have not set a home position yet. Please use "SET HOME HERE" first.', [{ text: 'OK', class: 'btn-warning' }]);
    return; 
  }
  const azError = getErrorValue('az', 'az-dir');
  const altError = getErrorValue('alt', 'alt-dir');
  
  // Tự động lưu cấu hình khi nhấn Align All
  const config = {
    align: {
      az: {
        d: parseInt(document.getElementById('az-deg').value) || 0,
        m: parseInt(document.getElementById('az-min').value) || 0,
        s: parseFloat(document.getElementById('az-sec').value) || 0,
        dir: document.getElementById('az-dir').checked
      },
      alt: {
        d: parseInt(document.getElementById('alt-deg').value) || 0,
        m: parseInt(document.getElementById('alt-min').value) || 0,
        s: parseFloat(document.getElementById('alt-sec').value) || 0,
        dir: document.getElementById('alt-dir').checked
      }
    }
  };
  sendCommand('saveConfig', config);

  sendCommand('align', {
    ra_error: azError,  // Mapping Az UI -> ra_error backend
    dec_error: altError // Mapping Alt UI -> dec_error backend
  });
});

// Align Az Only Button
const alignAzBtn = document.getElementById('align-az-btn');
if(alignAzBtn) alignAzBtn.addEventListener('click', () => {
  if (!isSystemHomed) { 
    showModal('Action Blocked', 'You have not set a home position yet.', [{ text: 'OK', class: 'btn-warning' }]);
    return; 
  }
  // Tự động lưu cấu hình AZ
  const config = {
    align: {
      az: {
        d: parseInt(document.getElementById('az-deg').value) || 0,
        m: parseInt(document.getElementById('az-min').value) || 0,
        s: parseFloat(document.getElementById('az-sec').value) || 0,
        dir: document.getElementById('az-dir').checked
      }
    }
  };
  sendCommand('saveConfig', config);
  const azError = getErrorValue('az', 'az-dir');
  sendCommand('align', { ra_error: azError, dec_error: 0 });
});

// Align Alt Only Button
const alignAltBtn = document.getElementById('align-alt-btn');
if(alignAltBtn) alignAltBtn.addEventListener('click', () => {
  if (!isSystemHomed) { 
    showModal('Action Blocked', 'You have not set a home position yet.', [{ text: 'OK', class: 'btn-warning' }]);
    return; 
  }
  // Tự động lưu cấu hình ALT
  const config = {
    align: {
      alt: {
        d: parseInt(document.getElementById('alt-deg').value) || 0,
        m: parseInt(document.getElementById('alt-min').value) || 0,
        s: parseFloat(document.getElementById('alt-sec').value) || 0,
        dir: document.getElementById('alt-dir').checked
      }
    }
  };
  sendCommand('saveConfig', config);
  const altError = getErrorValue('alt', 'alt-dir');
  sendCommand('align', { ra_error: 0, dec_error: altError });
});

// ===== WIFI SCAN & CONNECT =====
const scanWifiBtn = document.getElementById('scan-wifi-btn');

if (scanWifiBtn) {
  scanWifiBtn.addEventListener('click', () => {
    showModal('WiFi Scan', '<div class="wifi-scanning">Scanning networks...<br>Please wait...</div>', [{ text: 'Cancel' }]);
    sendCommand('scanWifi', {});
  });
}

// ===== ADMIN CONFIG =====
const adminBtn = document.getElementById('admin-config-btn');

if (adminBtn) {
  adminBtn.addEventListener('click', () => {
    const adminBody = `
      <div id="admin-login-error" style="color: red; margin-bottom: 10px; display: none;"></div>
      <div class="config-item">
        <label>Enter Password:</label>
        <input type="password" id="admin-pass-input-modal" placeholder="Password" class="input-field">
      </div>`;

    const checkAdminPass = () => {
      const passInput = document.getElementById('admin-pass-input-modal');
      if (passInput) {
        sendCommand('loginAdmin', { pass: passInput.value });
      }
    };

    showModal('Admin Access', adminBody, [
      { text: 'Unlock', class: 'btn-primary', closeOnClick: false, callback: checkAdminPass },
      { text: 'Cancel' }
    ]);

    // Focus and add Enter key listener after modal is shown
    setTimeout(() => {
      const passInput = document.getElementById('admin-pass-input-modal');
      if (passInput) {
        passInput.focus();
        passInput.addEventListener('keyup', (e) => {
          if (e.key === 'Enter') {
            checkAdminPass();
          }
        });
      }
    }, 100);
  });
}

const factoryZeroBtn = document.getElementById('factory-zero-btn');
if (factoryZeroBtn) {
  factoryZeroBtn.addEventListener('click', () => {
    showModal(
      'Confirm Factory Zero',
      'Set current position as <strong>Factory Zero</strong>?<br>This also applies <strong>SET HOME HERE</strong> at the same time.',
      [
        {
          text: 'Set Factory Zero',
          class: 'btn-danger',
          callback: () => {
            sendCommand('setFactoryZero', {});
            showMessage('Factory Zero set. Home updated.', '#save-message', 3000);
          }
        },
        { text: 'Cancel', class: 'btn-secondary' }
      ]
    );
  });
}

// ===== STOP CALIB BUTTON =====
const stopCalibBtn = document.getElementById('stop-calib-btn');

// ===== FACTORY RESET BUTTON =====
const factoryResetBtn = document.getElementById('factory-reset-btn');
if (factoryResetBtn) {
  factoryResetBtn.addEventListener('click', () => {
    showModal(
      '⚠️ Factory Reset',
      '<strong style="color:var(--danger);">WARNING:</strong> This will erase ALL settings (WiFi, motor config, limits, tuning, password) and reboot the device.<br><br>The device will restore factory defaults on next boot. This cannot be undone.<br><br>Are you sure?',
      [
        {
          text: 'Yes, Factory Reset',
          class: 'btn-danger',
          callback: () => {
            sendCommand('factoryReset', {});
            showMessage('Factory reset initiated. Device is rebooting...', '#save-message', 8000);
          }
        },
        { text: 'Cancel', class: 'btn-secondary' }
      ]
    );
  });
}

// ===== CHANGE PASSWORD BUTTON =====
const changePassBtn = document.getElementById('change-pass-btn');
if (changePassBtn) {
  changePassBtn.addEventListener('click', () => {
    const oldPass = (document.getElementById('admin-old-pass') || {}).value || '';
    const newPass = (document.getElementById('admin-new-pass') || {}).value || '';
    if (!newPass || newPass.length >= 64) {
      showMessage('⚠ New password must be 1–63 characters.', '#change-pass-msg', 3000);
      return;
    }
    sendCommand('changePassword', { old_pass: oldPass, new_pass: newPass });
  });
}
if(stopCalibBtn) stopCalibBtn.addEventListener('click', () => { sendCommand('stop', {}); });

// ===== CALIBRATION BUTTONS =====
// Auto Set Home button removed from Admin Config
// const autoSetHomeBtn = document.getElementById('auto-set-home-btn');

const calibAzBtn = document.getElementById('calib-az-btn');
if (calibAzBtn) calibAzBtn.addEventListener('click', () => {
  performCalibrationCheck(() => {
    const travelAz = parseFloat(document.getElementById('calib-travel-az').value) || 20;
    showModal(
      'Confirm Calibration',
      `Start AZIMUTH Axis Calibration?<br>Travel: ${travelAz}°<br><br>The AZ axis will move to both hard limits. <strong>Ensure the path is clear!</strong>`,
      [
        { text: 'Start Calibration', class: 'btn-info', callback: () => {
          sendCommand('calibAxis', { axis: 'az', travel_az: travelAz });
          showMessage('Calibrating AZ Axis... Please wait.', '#save-message', 10000);
        }},
        { text: 'Cancel' }
      ]
    );
  });
});

const calibAltBtn = document.getElementById('calib-alt-btn');
if (calibAltBtn) calibAltBtn.addEventListener('click', () => {
  performCalibrationCheck(() => {
    const travelAlt = parseFloat(document.getElementById('calib-travel-alt').value) || 30;
    showModal(
      'Confirm Calibration',
      `Start ALTITUDE Axis Calibration?<br>Travel: ${travelAlt}°<br><br>The ALT axis will move to both hard limits. <strong>Ensure the path is clear!</strong>`,
      [
        { text: 'Start Calibration', class: 'btn-info', callback: () => {
          sendCommand('calibAxis', { axis: 'alt', travel_alt: travelAlt });
          showMessage('Calibrating ALT Axis... Please wait.', '#save-message', 10000);
        }},
        { text: 'Cancel' }
      ]
    );
  });
});

const calibAllBtn = document.getElementById('calib-all-btn');
if (calibAllBtn) calibAllBtn.addEventListener('click', () => {
  performCalibrationCheck(() => {
    const travelAz = parseFloat(document.getElementById('calib-travel-az').value) || 20;
    const travelAlt = parseFloat(document.getElementById('calib-travel-alt').value) || 30;
    showModal(
      'Confirm Calibration',
      `Start ALL Axis Calibration?<br>Az Travel: ${travelAz}°, Alt Travel: ${travelAlt}°<br><br>Sequence: AZ then ALT.<br>The mount will move to limits on both axes.<br><strong>Ensure the path is clear!</strong>`,
      [
        { text: 'Start All', class: 'btn-primary', callback: () => {
          sendCommand('calibAxis', { axis: 'all', travel_az: travelAz, travel_alt: travelAlt });
          showMessage('Calibrating ALL Axes... Please wait.', '#save-message', 20000);
        }},
        { text: 'Cancel' }
      ]
    );
  });
});

modalCloseBtn.addEventListener('click', hideModal);
window.addEventListener('click', (e) => { if (e.target === modal) hideModal(); });

function renderWifiList(networks) {
  const listContainer = document.getElementById('modal-body');
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  if (networks.length === 0) {
    listContainer.innerHTML = '<div class="wifi-scanning">No networks found.</div>';
    return;
  }
  
  // Sắp xếp theo RSSI giảm dần (sóng mạnh lên đầu)
  networks.sort((a, b) => b.rssi - a.rssi);

  networks.forEach(net => {
    const itemContainer = document.createElement('div');
    itemContainer.className = 'wifi-item';
    itemContainer.innerHTML = `<span><strong>${net.ssid}</strong></span> <span>${net.rssi} dBm ${net.auth === 'SECURE' ? '🔒' : '🔓'}</span>`;
    itemContainer.addEventListener('click', () => {
      document.getElementById('wifi-ssid').value = net.ssid;
      hideModal();
      document.getElementById('wifi-pass').focus();
    });
    listContainer.appendChild(itemContainer);
    const item = document.createElement('div');
    item.className = 'wifi-item';
    item.innerHTML = `<span><strong>${net.ssid}</strong></span> <span>${net.rssi} dBm ${net.auth === 'SECURE' ? '🔒' : '🔓'}</span>`;
  });
  modalTitle.textContent = 'Select WiFi Network'; // Update title
}

// ===== LOGGING =====
function appendLog(message) {
  if (message.includes("Manual stop sequence completed. Hardlimit re-enabled.")) return;
  const now = new Date();
  const time = now.toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'history-entry';
  
  // Chuẩn bị nội dung text
  let fullText = `[${time}] ${message}`;
  
  // Tô màu log dựa trên từ khóa
  if (message.includes("[Apply]")) {
    entry.classList.add('log-apply');
  } else if (message.includes("Reset by User")) {
    entry.classList.add('log-reset');
  } else if (message.includes("Detecting")) {
    // Default color
  } else if (message.includes("CRITICAL") || message.includes("ERROR") || message.includes("Error") || message.includes("failed") || message.includes("Short to Ground") || message.includes("Over Temperature") || message.includes("Hardlimit reached")) {
    entry.classList.add('log-critical');
  } else if (message.includes("WARNING") || message.includes("limit") || message.includes("Limit") || message.includes("Hit") || message.includes("Pre-Warn") || message.includes("ALIGN ERROR")) {
    entry.classList.add('log-warning');
  } else if (message.includes("COMPLETED") || message.includes("Success") || message.includes("saved")) {
    entry.classList.add('log-success');
  }
  
  // Tô màu cam cho riêng cụm từ (Backlash applied)
  // Sử dụng innerHTML để chèn thẻ span màu
  fullText = fullText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Escape HTML cơ bản
  if (fullText.includes("(Backlash applied)")) {
    fullText = fullText.replace(/\(Backlash applied\)/g, '<span class="log-backlash">(Backlash applied)</span>');
  } else if (fullText.includes("Backlash applied")) {
    fullText = fullText.replace(/Backlash applied/g, '<span class="log-backlash">(Backlash applied)</span>');
  }
  
  entry.innerHTML = fullText;
  
  const logContainer = document.getElementById('system-log');
  if (!logContainer) return;

  if (logContainer.querySelector('.history-empty')) {
    logContainer.innerHTML = '';
  }
  
  // Thêm vào đầu danh sách (mới nhất lên trên)
  logContainer.insertBefore(entry, logContainer.firstChild);
  
  // Giới hạn 50 dòng log
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// ===== SERIAL LOG =====
function appendSerialLog(dir, message) {
  const now = new Date();
  const time = now.toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'history-entry';
  entry.classList.add(dir === 'RX' ? 'serial-log-rx' : 'serial-log-tx');
  const safe = String(message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  entry.textContent = `[${time}] ${dir === 'RX' ? '⬇ RX' : '⬆ TX'} ${safe}`;
  const container = document.getElementById('serial-log');
  if (!container) return;
  if (container.querySelector('.history-empty')) container.innerHTML = '';
  container.insertBefore(entry, container.firstChild);
  while (container.children.length > 200) container.removeChild(container.lastChild);
}

const resetErrorBtn = document.getElementById('reset-error-btn');
if(resetErrorBtn) resetErrorBtn.addEventListener('click', () => {
  sendCommand('resetError', {});
});

const clearLogBtn = document.getElementById('clear-log-btn');
if(clearLogBtn) clearLogBtn.addEventListener('click', () => {
  const logContainer = document.getElementById('system-log');
  if(logContainer) logContainer.innerHTML = '<div class="history-empty">Waiting for logs...</div>';
});

const toggleSerialLogBtn = document.getElementById('toggle-serial-log-btn');
if (toggleSerialLogBtn) toggleSerialLogBtn.addEventListener('change', () => {
  const panel = document.getElementById('serial-log-panel');
  const isChecked = toggleSerialLogBtn.checked;
  if (panel) panel.style.display = isChecked ? 'block' : 'none';
  // Gửi xuống backend để bật/tắt việc gửi gói tin Serial log qua WebSocket + lưu FRAM
  sendCommand('setSerialLog', { enabled: isChecked });
});

const clearSerialLogBtn = document.getElementById('clear-serial-log-btn');
if (clearSerialLogBtn) clearSerialLogBtn.addEventListener('click', () => {
  const container = document.getElementById('serial-log');
  if (container) container.innerHTML = '<div class="history-empty">Waiting for serial data...</div>';
});

// Lọc hiển thị RX/TX
function applySerialLogFilters() {
  const container = document.getElementById('serial-log');
  if (!container) return;
  const showRx = document.getElementById('show-serial-rx');
  const showTx = document.getElementById('show-serial-tx');
  container.classList.toggle('hide-rx', showRx ? !showRx.checked : false);
  container.classList.toggle('hide-tx', showTx ? !showTx.checked : false);
}

const showSerialRxCb = document.getElementById('show-serial-rx');
if (showSerialRxCb) showSerialRxCb.addEventListener('change', applySerialLogFilters);
const showSerialTxCb = document.getElementById('show-serial-tx');
if (showSerialTxCb) showSerialTxCb.addEventListener('change', applySerialLogFilters);

const clearHistoryBtn = document.getElementById('clear-history-btn');
if(clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => {
  // if (confirm('Clear movement history?')) {
  //   const hl = document.getElementById('history-log'); if(hl) hl.innerHTML = '<div class="history-empty">No movements yet</div>';
  // }
});

// ===== EXPORT LOG =====
const exportLogBtn = document.getElementById('export-log-btn');
if(exportLogBtn) exportLogBtn.addEventListener('click', () => {
  const logContainer = document.getElementById('system-log');
  if (!logContainer) return;  

  const entries = logContainer.querySelectorAll('.history-entry');
  if (entries.length === 0) {
    showModal('Export Log', 'No logs to export.', [{ text: 'OK', class: 'btn-primary' }]);
    return;
  }

  // Tạo nội dung CSV với Header
  let csvContent = "Timestamp,Message\n";
  
  entries.forEach(entry => {
    let text = entry.textContent;
    let time = "";
    let msg = text;
    
    // Tách thời gian và nội dung từ format "[HH:MM:SS] Message"
    const match = text.match(/^\[(.*?)\]\s+(.*)$/);
    if (match) {
      time = match[1];
      msg = match[2];
    }
    
    // Escape dấu ngoặc kép nếu có trong nội dung để không lỗi CSV
    msg = msg.replace(/"/g, '""');
    csvContent += `"${time}","${msg}"\n`;
  });

  // Tạo file blob và tải về
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "system_log.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// ===== UTILITY FUNCTIONS =====
function sendCommand(cmd, data) {
  if (systemLocked && cmd !== 'scanWifi' && cmd !== 'setSerialLog' && cmd !== 'resetError') {
    appendLog('ERROR: System is locked by PC (Serial Control is Active).');
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }
  
  const message = {
    cmd: cmd,
    data: data
  };
  
  ws.send(JSON.stringify(message));
}

// ===== SYSTEM LOCK (PC Serial đang điều khiển) =====
function applySystemLock(locked) {
  if (systemLocked === locked) return;
  systemLocked = locked;
  document.body.classList.toggle('system-locked', locked);
  if (locked) {
    appendLog('ERROR: System is locked by PC (Serial Control is Active).');
  } else {
    appendLog('System unlocked. Web control available.');
  }
}

// Ép hàm Tuning thành biến toàn cục (Window object) để chống lỗi ReferenceError
window.startTuning = function(axis) {
  const fwd = parseInt(document.getElementById('tuning-fwd-time').value) || 10;
  const rev = parseInt(document.getElementById('tuning-rev-time').value) || 20;
  console.log(`[Tuning] Starting for ${axis}: Fwd=${fwd}s, Rev=${rev}s`);
  sendCommand('startTuning', { axis: axis === 'az' ? 0 : 1, fwdTime: fwd, revTime: rev });
  showMessage(`Tuning ${axis.toUpperCase()}... Stay clear!`, '#save-message', 5000);
};

window.startTuningTcool = function(axis) {
  const fwd = parseInt(document.getElementById('tuning-fwd-time').value) || 10;
  const rev = parseInt(document.getElementById('tuning-rev-time').value) || 20;
  console.log(`[Tuning TCOOL] Starting for ${axis}: Fwd=${fwd}s, Rev=${rev}s`);
  sendCommand('startTuningTcool', { axis: axis === 'az' ? 0 : 1, fwdTime: fwd, revTime: rev });
  showMessage(`Tuning TCOOL ${axis.toUpperCase()}... Stay clear!`, '#save-message', 5000);
};

function showMessage(msg, elementId, duration = 2000) {
  const elem = document.querySelector(elementId);
  if (!elem) return;
  
  elem.textContent = msg;
  elem.style.display = 'block';
  
  setTimeout(() => {
    elem.style.display = 'none';
  }, duration);
}

function setRebootingStatus() {
  isRebooting = true;
  const statusEl = document.getElementById('system-status');
  if (statusEl) {
    statusEl.textContent = "REBOOTING";
    statusEl.classList.remove('status-text-success', 'status-text-danger', 'status-text-warning');
    statusEl.classList.add('status-text-success', 'font-bold');
  }
}

// ===== CHART FUNCTIONS =====
function initChart() {
  const canvas = document.getElementById('sg-chart');
  if (!canvas) return;
  
  // Set resolution
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  sgChartCtx = canvas.getContext('2d');
}

function updateChart(azVal, altVal, csAz = 31, csAlt = 31, tstepAz = 0, tstepAlt = 0) {
  if (!sgChartCtx) initChart();
  if (!sgChartCtx) return;
  
  const canvas = sgChartCtx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  
  // Shift data
  sgDataAz.push(azVal);
  sgDataAz.shift();
  sgDataAlt.push(altVal);
  sgDataAlt.shift();
  csDataAz.push(csAz);
  csDataAz.shift();
  csDataAlt.push(csAlt);
  csDataAlt.shift();
  
  // Clear
  sgChartCtx.clearRect(0, 0, w, h);
  
  // Config
  const maxVal = 510; // Max SG_RESULT value
  const maxCurrentMa = 2000; // Thang đo dòng điện tối đa 2000 mA
  const paddingLeft = 30; // Space for text labels
  const paddingRight = 45; // Tăng khoảng trống để chứa chữ "mA"
  const graphW = w - paddingLeft - paddingRight;
  
  // Draw Grid & Labels
  sgChartCtx.strokeStyle = '#f0f0f0';
  sgChartCtx.fillStyle = '#888';
  sgChartCtx.font = '10px sans-serif';
  sgChartCtx.textBaseline = 'middle';
  
  const steps = 5;
  for(let i=0; i<=steps; i++) {
    const val = Math.round(i * (maxVal / steps));
    const y = h - (val / maxVal * h);
    
    // Grid line
    sgChartCtx.beginPath();
    sgChartCtx.moveTo(paddingLeft, y);
    sgChartCtx.lineTo(w - paddingRight, y);
    sgChartCtx.stroke();
    
    // Labels
    // Điều chỉnh vị trí text để không bị cắt ở biên trên/dưới
    let textY = y;
    if (i === 0) textY -= 6; 
    if (i === steps) textY += 6;

    // Trục trái: StallGuard (0-510)
    sgChartCtx.textAlign = 'right';
    sgChartCtx.fillText(val, paddingLeft - 5, textY);

    // Trục phải: Actual Current (mA)
    sgChartCtx.textAlign = 'left';
    const val_ma = Math.round(i * (maxCurrentMa / steps));
    sgChartCtx.fillText(val_ma + ' mA', w - paddingRight + 5, textY);
  }
  
  // Helper to draw line
  const drawLine = (data, color, isCurrent = false) => {
    sgChartCtx.strokeStyle = color;
    sgChartCtx.lineWidth = isCurrent ? 1.5 : 2;
    sgChartCtx.setLineDash(isCurrent ? [5, 3] : []); // Nét đứt cho dòng điện
    sgChartCtx.beginPath();
    const step = graphW / (sgHistoryLength - 1);
    data.forEach((val, i) => {
      let y;
      if (isCurrent) {
        // Quy đổi CS (0-31) sang mA vật lý (Dựa trên Rsense = 0.11 và Vfs nội = 0.325V)
        const ma = ((val + 1) / 32) * 1767.76;
        y = h - (ma / maxCurrentMa * h);
      } else {
        // Scale 0-510 (StallGuard)
        y = h - (val / 510 * h);
      }
      const x = paddingLeft + i * step;
      if (i===0) sgChartCtx.moveTo(x, y); else sgChartCtx.lineTo(x, y);
    });
    sgChartCtx.stroke();
  };
  
  // Vẽ dòng điện trước (nằm dưới)
  drawLine(csDataAz, '#1abc9c', true); // Cyan
  drawLine(csDataAlt, '#f39c12', true); // Orange

  // Vẽ StallGuard sau (nằm trên)
  drawLine(sgDataAz, '#3498db'); // Blue
  drawLine(sgDataAlt, '#e74c3c'); // Red
  sgChartCtx.setLineDash([]); // Reset dash

  // Update chart footer with TSTEP values
  const chartFooter = document.querySelector('.chart-footer');
  if (chartFooter) {
    chartFooter.innerHTML = `SG: 0-510 (Solid) | Curr: 0-2000 mA (Dash)<br>AZ: TSTEP=${tstepAz} | ALT: TSTEP=${tstepAlt}`;
  }
}

// ===== THEME HANDLING =====
function initTheme() {
  const themeSelect = document.getElementById('theme-select');
  const savedTheme = localStorage.getItem('theme') || 'auto';
  
  if (themeSelect) {
    themeSelect.value = savedTheme;
    themeSelect.addEventListener('change', (e) => {
      const newTheme = e.target.value;
      localStorage.setItem('theme', newTheme);
      applyTheme(newTheme);
    });
  }
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme'); // Auto (Adaptive)
  }
}

function updateStepperDisplay(id) {
  const input = document.getElementById(id);
  const display = document.getElementById('disp-' + id);
  if (input && display) {
    display.textContent = input.value;
  }
}

// ===== OTA UPDATE FUNCTIONS =====
function parseVersionParts(version) {
  return String(version || '0.0.0').split('.').map((part) => parseInt(part, 10) || 0);
}

function compareVersionsDesc(versionA, versionB) {
  const a = parseVersionParts(versionA);
  const b = parseVersionParts(versionB);
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function formatUpdateReleaseDate(raw) {
  if (!raw) return 'Unknown';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('vi-VN');
}

function buildUpdateCatalog(files, meta) {
  const groups = new Map();
  const extras = { bootloader: null, partitions: null };

  files.forEach((file) => {
    const name = String(file.name || '');
    const lower = name.toLowerCase();
    if (!lower.endsWith('.bin')) return;

    if (lower.includes('bootloader')) {
      extras.bootloader = file;
      return;
    }
    if (lower.includes('partition')) {
      extras.partitions = file;
      return;
    }

    const kind = lower.includes('spiffs') ? 'spiffs' : (lower.includes('firmware') ? 'firmware' : '');
    if (!kind) return;

    const version = extractVersion(name);
    if (version === 'unknown') return;

    const entry = meta[name] || {};
    if (!groups.has(version)) {
      groups.set(version, {
        version,
        firmware: null,
        spiffs: null,
        releaseDateUtc: entry.release_date_utc || '',
        description: entry.description || '',
      });
    }

    const group = groups.get(version);
    group[kind] = {
      kind,
      name,
      url: file.download_url,
      size: file.size,
      description: entry.description || '',
      releaseDateUtc: entry.release_date_utc || '',
    };

    if (!group.description && entry.description) group.description = entry.description;
    if (!group.releaseDateUtc && entry.release_date_utc) group.releaseDateUtc = entry.release_date_utc;
  });

  const versions = Array.from(groups.values()).sort((a, b) => compareVersionsDesc(a.version, b.version));
  return { versions, extras };
}

function buildVersionOptionMarkup(group, checked) {
  const types = [];
  if (group.firmware) types.push('<span style="color:var(--primary); font-weight:bold;">Firmware</span>');
  if (group.spiffs) types.push('<span style="color:var(--success); font-weight:bold;">SPIFFS</span>');
  const desc = group.description || 'No description';
  const releaseDate = formatUpdateReleaseDate(group.releaseDateUtc);
  const sizeParts = [];
  if (group.firmware) sizeParts.push(`FW ${(group.firmware.size / 1024).toFixed(0)} KB`);
  if (group.spiffs) sizeParts.push(`SPIFFS ${(group.spiffs.size / 1024).toFixed(0)} KB`);

  return `
    <label class="checkbox-label" style="display:flex; align-items:flex-start; padding:12px; border-bottom:1px solid var(--border); cursor:pointer; width:100%;">
      <input type="radio" name="update-version" value="${group.version}" ${checked ? 'checked' : ''}>
      <div style="margin-left:10px; flex:1;">
        <div style="font-weight:bold;">Version ${group.version}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Package: ${types.join(' + ')}</div>
        <div style="font-size:11px; color:var(--text-muted);">Release: ${releaseDate}${sizeParts.length ? ' | ' + sizeParts.join(' | ') : ''}</div>
        <div style="font-size:11px; color:var(--text-muted);">${desc}</div>
      </div>
    </label>`;
}

function buildUpdateModalMarkup(catalog, options = {}) {
  const forceUsb = Boolean(options.forceUsb);
  const optionsHtml = catalog.versions.map((group, index) => buildVersionOptionMarkup(group, index === 0)).join('');
  const hasExtras = Boolean(catalog.extras.bootloader || catalog.extras.partitions);

  return `
    ${forceUsb ? `
      <div style="margin-bottom:12px; padding:10px; border:1px solid var(--warning); border-radius:6px; background: rgba(243, 156, 18, 0.08); color:var(--warning); font-size:12px;">
        Backend is not connected. USB Serial update has been selected automatically. OTA is unavailable right now.
      </div>
    ` : ''}
    <div id="online-version-list" style="max-height: 280px; overflow-y: auto; border:1px solid var(--border); border-radius:6px;">${optionsHtml}</div>
    <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border); display:grid; gap:10px;">
      <label class="checkbox-label" style="display:flex; align-items:center; gap:10px; width:100%;">
        <input type="checkbox" id="update-via-usb" ${forceUsb ? 'checked' : ''}>
        <span>Update via COM port (ESP Web Tools)</span>
      </label>
      <div id="usb-upload-options" class="${forceUsb ? '' : 'hidden'}" style="display:${forceUsb ? 'grid' : 'none'}; gap:10px; padding-left:24px; border-left:2px solid var(--border);">
        <div id="usb-upload-extra-options" style="display:grid; gap:8px; ${hasExtras ? '' : 'display:none;'}">
          ${catalog.extras.bootloader ? '<label class="checkbox-label" style="display:flex; align-items:center; gap:10px;"><input type="checkbox" id="include-bootloader"><span>Upload bootloader</span></label>' : ''}
          ${catalog.extras.partitions ? '<label class="checkbox-label" style="display:flex; align-items:center; gap:10px;"><input type="checkbox" id="include-partitions"><span>Upload partitions</span></label>' : ''}
        </div>
        <label class="checkbox-label" style="display:flex; align-items:center; gap:10px; width:100%;">
          <input type="checkbox" id="update-local-offline">
          <span>Local update (use offline .bin files)</span>
        </label>
        <div id="local-update-options" class="hidden" style="display:none; gap:10px; border:1px dashed var(--border); border-radius:6px; padding:10px;">
          <input type="file" id="local-update-files" multiple accept=".bin" style="display:none;">
          <button type="button" class="btn btn-secondary btn-small" id="pick-local-update-files">Select local .bin files</button>
          <div style="font-size:11px; color:var(--text-muted);">Detected by filename keywords only: firmware, bootloader, partition/partitions, spiffs.</div>
          <div id="local-update-file-list" style="display:grid; gap:8px;"></div>
        </div>
        <div style="font-size:11px; color:var(--text-muted);">ESP Web Tools uses Web Serial &mdash; COM port is selected via browser native dialog when clicking <b>INSTALL</b>. Requires Chrome/Edge and a secure context (HTTPS or localhost).</div>
        <div id="usb-context-warning" style="display:none; border:1px solid var(--danger); border-radius:6px; padding:10px; background: rgba(231, 76, 60, 0.08);">
          <div style="font-size:12px; color:var(--danger); margin-bottom:8px;">
            This page is running in an insecure context (likely ESP HTTP IP). Web Serial is blocked here.
          </div>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">
            Open the Beta UI page to continue the USB Serial update flow:
            <div id="beta-ui-target-url" style="margin-top:4px; word-break:break-all;"></div>
          </div>
          <button type="button" class="btn btn-secondary btn-small" id="open-beta-ui-page">Open Beta UI</button>
        </div>
        <div id="update-modal-usb-host" class="hidden"></div>
      </div>
      <div id="update-modal-error" style="display:none; color:var(--danger); font-size:12px;"></div>
    </div>`;
}

function showUpdateModalError(message) {
  const errorEl = document.getElementById('update-modal-error');
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function clearUpdateModalError() {
  const errorEl = document.getElementById('update-modal-error');
  if (!errorEl) return;
  errorEl.textContent = '';
  errorEl.style.display = 'none';
}

function detectFlashKindFromName(filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.includes('bootloader')) return 'bootloader';
  if (lower.includes('partition')) return 'partitions';
  if (lower.includes('firmware')) return 'firmware';
  if (lower.includes('spiffs')) return 'spiffs';
  return '';
}

function collectLocalUpdateFiles() {
  const input = document.getElementById('local-update-files');
  const selected = {
    bootloader: null,
    partitions: null,
    firmware: null,
    spiffs: null,
  };
  if (!input || !input.files) return selected;

  Array.from(input.files).forEach((file) => {
    const kind = detectFlashKindFromName(file.name);
    if (!kind) return;
    if (!selected[kind]) selected[kind] = file;
  });
  return selected;
}

function renderLocalUpdateFileList() {
  const container = document.getElementById('local-update-file-list');
  if (!container) return;

  const filesByKind = collectLocalUpdateFiles();
  const items = [];
  FLASH_KIND_ORDER.forEach((kind) => {
    const file = filesByKind[kind];
    if (!file) return;
    items.push(`
      <label class="checkbox-label" style="display:flex; align-items:flex-start; gap:10px; width:100%;">
        <input type="checkbox" id="local-file-kind-${kind}" checked>
        <span style="font-size:12px;"><strong>${kind}</strong>: ${file.name} <span style="color:var(--text-muted);">(${(file.size / 1024).toFixed(1)} KB)</span></span>
      </label>
    `);
  });

  if (!items.length) {
    container.innerHTML = '<div style="font-size:12px; color:var(--warning);">No recognized file found. Select .bin files containing names: firmware, bootloader, partition(s), spiffs.</div>';
    return;
  }

  container.innerHTML = items.join('');
}

function getSelectedLocalParts() {
  const filesByKind = collectLocalUpdateFiles();
  const parts = [];

  FLASH_KIND_ORDER.forEach((kind) => {
    const file = filesByKind[kind];
    const enabled = document.getElementById(`local-file-kind-${kind}`)?.checked;
    if (!file || !enabled) return;
    const fileUrl = URL.createObjectURL(file);
    parts.push({ kind, path: fileUrl, offset: FLASH_OFFSETS[kind], _blobUrl: fileUrl });
  });

  return parts;
}

function getPublicUsbUpdateUrl() {
  return PUBLIC_USB_UPDATE_URL;
}

function refreshUsbContextWarning() {
  const warningEl = document.getElementById('usb-context-warning');
  if (!warningEl) return;

  const insecureContext = !window.isSecureContext;
  warningEl.style.display = insecureContext ? 'block' : 'none';

  if (!insecureContext) return;

  const targetUrl = getPublicUsbUpdateUrl();
  const urlEl = document.getElementById('beta-ui-target-url');
  if (urlEl) urlEl.textContent = targetUrl;

  const openBtn = document.getElementById('open-beta-ui-page');
  if (openBtn) {
    openBtn.onclick = () => {
      window.open(targetUrl, '_blank', 'noopener');
    };
  }
}

function wireUpdateModalInteractions(catalog, options = {}) {
  const forceUsb = Boolean(options.forceUsb);
  const usbCheckbox = document.getElementById('update-via-usb');
  const usbOptions = document.getElementById('usb-upload-options');
  const localCheckbox = document.getElementById('update-local-offline');
  const localOptions = document.getElementById('local-update-options');
  const onlineList = document.getElementById('online-version-list');
  const extrasBlock = document.getElementById('usb-upload-extra-options');
  const pickBtn = document.getElementById('pick-local-update-files');
  const fileInput = document.getElementById('local-update-files');
  const primaryActionBtn = document.getElementById('update-primary-action-btn');
  const versionInputs = Array.from(document.querySelectorAll('input[name="update-version"]'));
  const bootloaderCheckbox = document.getElementById('include-bootloader');
  const partitionsCheckbox = document.getElementById('include-partitions');
  if (!usbCheckbox || !usbOptions || !localCheckbox || !localOptions || !onlineList) return;

  const refreshPrimaryActionLabel = async () => {
    if (!primaryActionBtn) return;
    primaryActionBtn.textContent = 'START UPDATE';
    primaryActionBtn.style.display = usbCheckbox.checked ? 'none' : '';
    if (usbCheckbox.checked) {
      await renderUsbDashboardInModal(catalog);
    } else {
      clearUsbDashboardHost(document.getElementById('update-modal-usb-host'));
    }
  };

  if (forceUsb) {
    usbCheckbox.checked = true;
    usbOptions.classList.remove('hidden');
    usbOptions.style.display = 'grid';
    refreshUsbContextWarning();
  }

  usbCheckbox.addEventListener('change', async (e) => {
    clearUpdateModalError();
    if (!e.target.checked && forceUsb) {
      e.target.checked = true;
      showUpdateModalError('Backend is not connected. USB Serial update is required, so this option cannot be turned off right now.');
      await refreshPrimaryActionLabel();
      return;
    }

    if (e.target.checked) {
      usbOptions.classList.remove('hidden');
      usbOptions.style.display = 'grid';
      refreshUsbContextWarning();
      // Preload web component early to keep CONNECT flow snappy.
      ensureEspWebToolsLoaded().catch((error) => console.warn('ESP Web Tools preload failed:', error));
    } else {
      usbOptions.classList.add('hidden');
      usbOptions.style.display = 'none';
      // Reset local sub-mode when USB is unchecked
      if (localCheckbox && localCheckbox.checked) {
        localCheckbox.checked = false;
        localOptions.classList.add('hidden');
        localOptions.style.display = 'none';
        if (extrasBlock && extrasBlock.children.length > 0) extrasBlock.style.display = 'grid';
      }
      onlineList.style.display = 'block';
    }
    await refreshPrimaryActionLabel();
  });

  localCheckbox.addEventListener('change', (e) => {
    clearUpdateModalError();
    if (e.target.checked) {
      localOptions.classList.remove('hidden');
      localOptions.style.display = 'grid';
      onlineList.style.display = 'none';
      // Hide bootloader/partitions extras — local mode manages its own files
      if (extrasBlock) extrasBlock.style.display = 'none';
    } else {
      localOptions.classList.add('hidden');
      localOptions.style.display = 'none';
      onlineList.style.display = 'block';
      // Restore extras block if it has content
      if (extrasBlock && extrasBlock.children.length > 0) extrasBlock.style.display = 'grid';
    }
    refreshPrimaryActionLabel();
  });

  if (pickBtn && fileInput) {
    pickBtn.addEventListener('click', () => {
      fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
      renderLocalUpdateFileList();
      await refreshPrimaryActionLabel();
    });
  }

  versionInputs.forEach((input) => {
    input.addEventListener('change', () => {
      refreshPrimaryActionLabel();
    });
  });

  if (bootloaderCheckbox) {
    bootloaderCheckbox.addEventListener('change', () => {
      refreshPrimaryActionLabel();
    });
  }

  if (partitionsCheckbox) {
    partitionsCheckbox.addEventListener('change', () => {
      refreshPrimaryActionLabel();
    });
  }

  refreshPrimaryActionLabel();
}

function isGroupAlreadyInstalled(group) {
  const checks = [];
  if (group.firmware) checks.push(group.version === currentFwVer);
  if (group.spiffs) checks.push(group.version === currentSpiffsVer);
  return checks.length > 0 && checks.every(Boolean);
}

function createOtaStepsFromGroup(group) {
  const steps = [];
  if (group.firmware) steps.push({ type: 'firmware', url: group.firmware.url, filename: group.firmware.name, rebootAfter: false });
  if (group.spiffs) steps.push({ type: 'spiffs', url: group.spiffs.url, filename: group.spiffs.name, rebootAfter: false });
  if (steps.length) steps[steps.length - 1].rebootAfter = true;
  return steps;
}

function hasWebSerialSupport() {
  return Boolean(window.isSecureContext && 'serial' in navigator);
}

async function ensureEspWebToolsLoaded() {
  if (customElements.get('esp-web-install-button')) return;
  if (!espWebToolsLoader) {
    espWebToolsLoader = import(ESP_WEB_TOOLS_MODULE_URL);
  }
  await espWebToolsLoader;
}

function buildEspWebToolsParts(group, catalog) {
  const parts = [];

  if (document.getElementById('include-bootloader')?.checked && catalog.extras.bootloader) {
    parts.push({ path: catalog.extras.bootloader.download_url, offset: FLASH_OFFSETS.bootloader });
  }
  if (document.getElementById('include-partitions')?.checked && catalog.extras.partitions) {
    parts.push({ path: catalog.extras.partitions.download_url, offset: FLASH_OFFSETS.partitions });
  }
  if (group.firmware) {
    parts.push({ path: group.firmware.url, offset: FLASH_OFFSETS.firmware });
  }
  if (group.spiffs) {
    parts.push({ path: group.spiffs.url, offset: FLASH_OFFSETS.spiffs });
  }

  return parts;
}

function createEspWebToolsManifestUrl(group, catalog, localParts = null) {
  const parts = localParts || buildEspWebToolsParts(group, catalog);
  if (!parts.length) return null;

  const manifest = {
    name: `MLAstro RPA ${group?.version || 'local'}`,
    version: group?.version || 'local',
    new_install_prompt_erase: true,
    builds: [
      {
        chipFamily: 'ESP32',
        parts: parts.map((p) => ({ path: p.path, offset: p.offset })),
      },
    ],
  };

  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  return URL.createObjectURL(blob);
}

function hasSelectedUsbExtra(catalog) {
  const bootSelected = Boolean(document.getElementById('include-bootloader')?.checked && catalog.extras.bootloader);
  const partSelected = Boolean(document.getElementById('include-partitions')?.checked && catalog.extras.partitions);
  return bootSelected || partSelected;
}

function releaseActiveUsbArtifacts() {
  if (activeUsbManifestUrl) {
    URL.revokeObjectURL(activeUsbManifestUrl);
    activeUsbManifestUrl = null;
  }
  if (Array.isArray(activeUsbLocalBlobUrls)) {
    activeUsbLocalBlobUrls.forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  activeUsbLocalBlobUrls = [];
}

function clearUsbDashboardHost(host) {
  if (!host) return;
  host.innerHTML = '';
  host.classList.add('hidden');
  releaseActiveUsbArtifacts();
}

async function renderUsbDashboardInModal(catalog) {
  const host = document.getElementById('update-modal-usb-host');
  const usbCheckbox = document.getElementById('update-via-usb');
  const localCheckbox = document.getElementById('update-local-offline');
  if (!host || !usbCheckbox?.checked) {
    clearUsbDashboardHost(host);
    return;
  }

  releaseActiveUsbArtifacts();
  host.classList.remove('hidden');

  if (!hasWebSerialSupport()) {
    host.innerHTML = '<div class="usb-flash-card"><div class="usb-flash-title">USB Flash Dashboard</div><div class="usb-flash-help">Web Serial unavailable here. Use Chrome/Edge on HTTPS or localhost.</div></div>';
    return;
  }

  let selectedGroup = null;
  let localParts = null;
  let packageLabel = 'selected package';
  const localMode = Boolean(localCheckbox?.checked);

  if (localMode) {
    localParts = getSelectedLocalParts();
    if (!localParts.length) {
      host.innerHTML = '<div class="usb-flash-card"><div class="usb-flash-title">USB Flash Dashboard</div><div class="usb-flash-help">Select local .bin files to enable CONNECT.</div></div>';
      return;
    }
    activeUsbLocalBlobUrls = localParts.map((part) => part._blobUrl).filter(Boolean);
    packageLabel = 'local files';
  } else {
    const selectedVersion = document.querySelector('input[name="update-version"]:checked')?.value;
    selectedGroup = catalog.versions.find((group) => group.version === selectedVersion);
    if (!selectedGroup) {
      host.innerHTML = '<div class="usb-flash-card"><div class="usb-flash-title">USB Flash Dashboard</div><div class="usb-flash-help">Select a version to enable CONNECT.</div></div>';
      return;
    }
    packageLabel = `version ${selectedGroup.version}`;
  }

  try {
    await ensureEspWebToolsLoaded();
  } catch (error) {
    host.innerHTML = `<div class="usb-flash-card"><div class="usb-flash-title">USB Flash Dashboard</div><div class="usb-flash-help">Cannot load ESP Web Tools: ${error.message || error}</div></div>`;
    return;
  }

  const manifestUrl = createEspWebToolsManifestUrl(selectedGroup, catalog, localParts);
  if (!manifestUrl) {
    host.innerHTML = '<div class="usb-flash-card"><div class="usb-flash-title">USB Flash Dashboard</div><div class="usb-flash-help">No package selected to upload via USB.</div></div>';
    return;
  }
  activeUsbManifestUrl = manifestUrl;

  host.innerHTML = `
    <div class="usb-flash-card">
      <div class="usb-flash-title">USB Flash Dashboard</div>
      <div class="usb-flash-help">Selected package: <strong>${packageLabel}</strong>. Click CONNECT below to choose COM and flash.</div>
      <esp-web-install-button id="update-modal-esp-web-install-btn" manifest="${manifestUrl}"></esp-web-install-button>
    </div>`;

  const installBtn = document.getElementById('update-modal-esp-web-install-btn');
  if (!installBtn) return;

  installBtn.addEventListener('click', () => {
    otaMode = 'usb';
    hideOtaProgressUI();
    hideOtaInstallOverlay();
    if (modal) {
      // Keep the session alive but visually dismiss the chooser modal so it doesn't block ESP Web Tools UI.
      setTimeout(() => {
        modal.classList.add('modal-detached');
      }, 0);
    }
  });

  installBtn.addEventListener('state-changed', (event) => {
    const detail = event.detail || {};
    console.log('[USB Flash State]', detail.state);
    updateUsbProgressFromState(detail);

    if (detail.state === 'finished') {
      usbFlashPhase = 'finished';
      showMessage('USB flashing complete. Device rebooting...', '#save-message', 5000);
      setTimeout(() => {
        clearUsbDashboardHost(host);
        hideModal();
      }, 1000);
    } else if (detail.state === 'error') {
      showMessage(`USB flashing error: ${detail.error || 'unknown'}`, '#save-message', 5000);
      if (modal) {
        modal.classList.remove('modal-detached');
      }
    }
  });
}

async function startUsbEspWebToolsInstall(group, catalog, localParts = null) {
  clearUpdateModalError();

  if (!hasWebSerialSupport()) {
    showUpdateModalError('Web Serial unavailable. Open this page on HTTPS/localhost using Chrome or Edge.');
    return;
  }

  try {
    await ensureEspWebToolsLoaded();
  } catch (err) {
    showUpdateModalError(`Cannot load ESP Web Tools module: ${err.message || err}`);
    return;
  }

  const manifestUrl = createEspWebToolsManifestUrl(group, catalog, localParts);
  if (!manifestUrl) {
    showUpdateModalError('No package selected to upload via USB.');
    return;
  }

  hideModal();
  otaPlan = null;
  otaCurrentStepIndex = -1;
  otaMode = 'usb';
  usbFlashProgressHint = 0;
  usbFlashPhase = 'erasing';
  ensureProgressVisible(formatUsbPhaseChecklist('erasing', `ready for ${group?.version || 'local files'}...`));
  updateProgressUI(0, formatUsbPhaseChecklist('erasing', 'waiting for CONNECT in USB dashboard...'));

  const host = document.getElementById('usb-flash-host');
  if (!host) {
    showMessage('USB flash host not found in System Update panel.', '#save-message', 5000);
    return;
  }

  host.classList.remove('hidden');
  host.innerHTML = `
    <div class="usb-flash-card">
      <div class="usb-flash-title">USB Flash Dashboard</div>
      <div class="usb-flash-help">Selected package: <strong>${group?.version || 'local files'}</strong>. Use the CONNECT button below to choose the COM port and start flashing.</div>
      <esp-web-install-button id="esp-web-install-btn" manifest="${manifestUrl}"></esp-web-install-button>
    </div>`;

  await new Promise(r => setTimeout(r, 100));

  const installBtn = document.getElementById('esp-web-install-btn');
  if (!installBtn) {
    host.classList.add('hidden');
    host.innerHTML = '';
    showMessage('USB flash component failed to load.', '#save-message', 5000);
    return;
  }

  // Listen for flashing events
  installBtn.addEventListener('state-changed', (event) => {
    const detail = event.detail || {};
    console.log('[USB Flash State]', detail.state);
    updateUsbProgressFromState(detail);
    
    if (detail.state === 'finished') {
      usbFlashPhase = 'finished';
      updateProgressUI(100, formatUsbPhaseChecklist('finished', 'rebooting into application...'));
      showMessage('USB flashing complete. Device rebooting...', '#save-message', 5000);
      setTimeout(() => {
        host.innerHTML = '';
        host.classList.add('hidden');
      }, 1000);
    } else if (detail.state === 'error') {
      updateProgressUI(usbFlashProgressHint || 0, `USB flash failed: ${detail.error || 'unknown error'}`);
      showMessage(`USB flashing error: ${detail.error || 'unknown'}`, '#save-message', 5000);
      setTimeout(() => {
        host.innerHTML = '';
        host.classList.add('hidden');
      }, 3000);
    }
  });

  installBtn.addEventListener('click', () => {
    updateProgressUI(5, formatUsbPhaseChecklist('erasing', 'opening COM chooser...'));
    showMessage(`Open COM chooser for ${group?.version || 'local files'} and start flashing.`, '#save-message');
  });

  // Cleanup blob URLs after timeout
  setTimeout(() => {
    URL.revokeObjectURL(manifestUrl);
    if (Array.isArray(localParts)) {
      localParts.forEach((p) => {
        if (p._blobUrl) URL.revokeObjectURL(p._blobUrl);
      });
    }
  }, 120000);
}

function ensureProgressVisible(labelText) {
  const progressContainer = document.getElementById('ota-progress-container');
  if (progressContainer) progressContainer.classList.remove('hidden');
  document.getElementById('ota-status-label').textContent = labelText;
  document.getElementById('ota-progress-bar').style.width = '0%';
  document.getElementById('ota-percent').textContent = '0%';
}

function updateProgressUI(percent, labelText) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const progressContainer = document.getElementById('ota-progress-container');
  const bar = document.getElementById('ota-progress-bar');
  const text = document.getElementById('ota-percent');
  const label = document.getElementById('ota-status-label');
  if (progressContainer) progressContainer.classList.remove('hidden');
  if (bar) bar.style.width = `${safePercent}%`;
  if (text) text.textContent = `${Math.round(safePercent)}%`;
  if (label && labelText) label.textContent = labelText;
}

function formatUsbPhaseChecklist(phase, suffix = '') {
  const states = {
    erasing: '[ ] erasing',
    writing: '[ ] writing',
    verifying: '[ ] verifying',
  };

  if (phase === 'erasing') {
    states.erasing = '[>] erasing';
  } else if (phase === 'writing') {
    states.erasing = '[x] erasing';
    states.writing = '[>] writing';
  } else if (phase === 'verifying') {
    states.erasing = '[x] erasing';
    states.writing = '[x] writing';
    states.verifying = '[>] verifying';
  } else if (phase === 'finished') {
    states.erasing = '[x] erasing';
    states.writing = '[x] writing';
    states.verifying = '[x] verifying';
  }

  return `USB flash: ${states.erasing}  ${states.writing}  ${states.verifying}${suffix ? ` | ${suffix}` : ''}`;
}

function updateUsbProgressFromState(detail) {
  const state = String(detail?.state || '').toLowerCase();
  const rawProgress = detail?.progress;

  const getPhaseFromStateOrProgress = (progressValue) => {
    if (state.includes('finished')) return 'finished';
    if (state.includes('verif')) return 'verifying';
    if (state.includes('writ') || state.includes('flash')) return 'writing';
    if (state.includes('eras')) return 'erasing';
    if (Number.isFinite(progressValue)) {
      if (progressValue >= 85) return 'verifying';
      if (progressValue >= 30) return 'writing';
      if (progressValue >= 8) return 'erasing';
    }
    return usbFlashPhase;
  };

  const getUsbStateLabel = (phase) => {
    if (phase === 'finished') return formatUsbPhaseChecklist('finished', 'rebooting into application...');
    if (state.includes('connecting')) return formatUsbPhaseChecklist(phase, 'resetting ESP into bootloader...');
    if (state.includes('prepar')) return formatUsbPhaseChecklist(phase, 'preparing installer...');
    return formatUsbPhaseChecklist(phase);
  };

  if (Number.isFinite(rawProgress)) {
    const normalized = rawProgress <= 1 ? rawProgress * 100 : rawProgress;
    usbFlashProgressHint = Math.max(usbFlashProgressHint, normalized);
    usbFlashPhase = getPhaseFromStateOrProgress(usbFlashProgressHint);
    updateProgressUI(usbFlashProgressHint, getUsbStateLabel(usbFlashPhase));
    return;
  }

  const hints = {
    preparing: 10,
    connecting: 15,
    erasing: 30,
    writing: 55,
    flashing: 70,
    verifying: 85,
    finished: 100,
  };

  let target = usbFlashProgressHint;
  for (const [key, value] of Object.entries(hints)) {
    if (state.includes(key)) {
      target = Math.max(target, value);
      break;
    }
  }

  if (target === usbFlashProgressHint && state && state !== 'finished') {
    target = Math.min(95, usbFlashProgressHint + 5);
  }

  usbFlashProgressHint = target;
  usbFlashPhase = getPhaseFromStateOrProgress(target);
  updateProgressUI(target, getUsbStateLabel(usbFlashPhase));
}

function startNextPlannedOtaStep() {
  if (!otaPlan || otaMode !== 'ota') return;
  otaCurrentStepIndex += 1;
  const step = otaPlan.steps[otaCurrentStepIndex];
  if (!step) {
    otaPlan = null;
    otaCurrentStepIndex = -1;
    return;
  }

  showOtaInstallOverlay(`Installing ${step.type} (${otaCurrentStepIndex + 1}/${otaPlan.steps.length})...`, 0);
  sendCommand('otaUpdate', { type: step.type, url: step.url, reboot_after: step.rebootAfter });
}

async function checkAllUpdates() {
  const repoOwner = 'MLAstroRPA';
  const repoName = 'Update';
  const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/`;
  const metaUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/meta.json`;

  showModal('Checking Updates', `<div class="wifi-scanning">Connecting to GitHub...</div>`);

  try {
    const [response, metaResp, backendAvailable] = await Promise.all([fetch(apiUrl), fetch(metaUrl), waitForBackendStatus(1200)]);
    if (!response.ok) throw new Error('Failed to reach GitHub');

    const files = await response.json();
    let meta = {};
    if (metaResp.ok) {
      try {
        const parsed = await metaResp.json();
        if (parsed && typeof parsed === 'object') meta = parsed;
      } catch (error) {
        console.warn('meta.json parse failed, continue without description', error);
      }
    }

    const catalog = buildUpdateCatalog(files, meta);
    if (!catalog.versions.length) {
      showModal('No Updates', 'No versioned firmware/spiffs packages were found in the repository.');
      return;
    }

    const forceUsb = !backendAvailable;

    showModal('Available Updates', buildUpdateModalMarkup(catalog, { forceUsb }), [
      {
        id: 'update-primary-action-btn',
        text: 'START UPDATE',
        class: 'btn-danger',
        closeOnClick: false,
        callback: async () => {
          clearUpdateModalError();
          const useUsb = Boolean(document.getElementById('update-via-usb')?.checked);
          const localMode = useUsb && Boolean(document.getElementById('update-local-offline')?.checked);

          if (forceUsb && !useUsb) {
            showUpdateModalError('Backend is not connected. Only USB Serial update is available.');
            return;
          }

          if (useUsb) {
            showUpdateModalError(localMode
              ? 'Use the USB Flash Dashboard shown in this modal to click CONNECT and flash the selected local files.'
              : 'Use the USB Flash Dashboard shown in this modal to click CONNECT and flash the selected package.');
            return;
          }

          const selectedVersion = document.querySelector('input[name="update-version"]:checked')?.value;
          const selectedGroup = catalog.versions.find((group) => group.version === selectedVersion);
          if (!selectedGroup) {
            showUpdateModalError('Please select a version.');
            return;
          }

          if (isGroupAlreadyInstalled(selectedGroup)) {
            showUpdateModalError(`Version ${selectedGroup.version} is already active for all selected packages.`);
            return;
          }

          const steps = createOtaStepsFromGroup(selectedGroup);
          if (!steps.length) {
            showUpdateModalError('No OTA package was found for the selected version.');
            return;
          }

          hideModal();
          otaMode = 'ota';
          otaPlan = { version: selectedGroup.version, steps };
          otaCurrentStepIndex = -1;
          startNextPlannedOtaStep();
        },
      },
      { text: 'Cancel' },
    ]);

    wireUpdateModalInteractions(catalog, { forceUsb });
  } catch (err) {
    showModal('Error', `GitHub API Error: ${err.message}`, [{ text: 'OK' }]);
  }
}

// ===== SAVE RELATIVE SETTINGS TO FRAM =====
function saveRelativeSettings() {
  if (isUpdatingFromWS) return; // Không gửi lệnh nếu đang trong quá trình đồng bộ UI từ Server
  
  const relativeConfig = {
    relative: {
      mode: document.getElementById('move-mode-toggle').checked,
      d: parseInt(document.getElementById('rel-d').value) || 0,
      m: parseInt(document.getElementById('rel-m').value) || 0,
      s: parseInt(document.getElementById('rel-s').value) || 0
    }
  };
  sendCommand('saveConfig', relativeConfig);
}

function initSteppers() {
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetId = btn.dataset.target;
      const step = parseInt(btn.dataset.step);
      const input = document.getElementById(targetId);
      
      if (input) {
        let val = parseInt(input.value) || 0;
        let min = parseInt(input.getAttribute('min'));
        let max = parseInt(input.getAttribute('max'));
        
        val += step;
        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;
        
        input.value = val;
        updateStepperDisplay(targetId);
        saveRelativeSettings(); // Lưu ngay khi thay đổi giá trị
      }
    });
  });
}

// ===== JOG / RELATIVE MODE =====
let isRelativeMode = false;

function initControlMode() {
  const toggle = document.getElementById('move-mode-toggle');
  const options = document.getElementById('relative-options');
  
  if (toggle && options) {
    toggle.addEventListener('change', (e) => {
      isRelativeMode = e.target.checked;
      if (isRelativeMode) {
        options.classList.remove('hidden');
      } else {
        options.classList.add('hidden');
      }
      saveRelativeSettings(); // Lưu ngay khi thay đổi chế độ
    });
    
    // Init state
    isRelativeMode = toggle.checked;
    if(!isRelativeMode) options.classList.add('hidden');
    
    // Initialize stepper buttons
    initSteppers();
  }
}

function initMotorModeChangeHandlers() {
  const hlCheckbox = document.getElementById('enable-hardlimit');
  const azSpread = document.getElementById('az-mode-spreadcycle');
  const altSpread = document.getElementById('alt-mode-spreadcycle');
  const azMstep = document.getElementById('az-microsteps');
  const altMstep = document.getElementById('alt-microsteps');

  const onSpreadChecked = (radioEl) => {
    if (isUpdatingFromWS) return; // Không hiện modal khi load cấu hình từ server
    
    if (hlCheckbox && hlCheckbox.checked) {
      showModal('Confirm Mode Change', 'SpreadCycle is not compatible with StallGuard (Hardlimit). Disable Hardlimit now?', [
        { text: 'OK', class: 'btn-primary', callback: () => { 
          hlCheckbox.checked = false; 
          // Trigger change event manually to update monitor panel visibility if needed
          hlCheckbox.dispatchEvent(new Event('change'));
        } },
        { text: 'Cancel', class: 'btn-secondary', callback: () => {
          // Nếu Cancel, chọn lại nút StealthChop cho trục tương ứng
          const axis = radioEl.id.startsWith('az') ? 'az' : 'alt';
          const stealthRadio = document.getElementById(`${axis}-mode-stealthchop`);
          if (stealthRadio) stealthRadio.checked = true;
        } }
      ]);
    }
  };

// ===========================
// SCROLL TO BOTTOM BUTTON
// ===========================
(function() {
  const btn = document.getElementById('scroll-bottom-btn');
  if (!btn) return;
  window.addEventListener('scroll', function() {
    const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);
    btn.classList.toggle('visible', !nearBottom && window.scrollY > 200);
  }, { passive: true });
  btn.addEventListener('click', function() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
})();

  const onMstepChanged = (selectEl) => {
    if (isUpdatingFromWS) return;
    const val = parseInt(selectEl.value);
    // Nếu chọn >= 64 mà Hardlimit đang bật thì yêu cầu tắt
    if (val >= 64 && hlCheckbox && hlCheckbox.checked) {
      showModal('High Microstep Alert', 'StallGuard (Hardlimit) is not reliable at >= 64 microsteps. Disable Hardlimit now?', [
        { text: 'OK', class: 'btn-primary', callback: () => { 
          hlCheckbox.checked = false; 
          // Trigger change event manually to update UI & monitor status
          hlCheckbox.dispatchEvent(new Event('change'));
          selectEl.dataset.prev = val; // Cập nhật mốc mới
        } },
        { text: 'Cancel', class: 'btn-secondary', callback: () => {
          // Trả về giá trị cũ nếu người dùng hủy
          selectEl.value = selectEl.dataset.prev || 16;
        } }
      ]);
    } else {
      selectEl.dataset.prev = val;
    }
  };

  if (azSpread) azSpread.addEventListener('change', (e) => { if (e.target.checked) onSpreadChecked(e.target); });
  if (altSpread) altSpread.addEventListener('change', (e) => { if (e.target.checked) onSpreadChecked(e.target); });
  if (azMstep) azMstep.addEventListener('change', (e) => onMstepChanged(e.target));
  if (altMstep) altMstep.addEventListener('change', (e) => onMstepChanged(e.target));

  // Chặn người dùng bật Hardlimit nếu vi bước đang >= 64
  if (hlCheckbox) {
    hlCheckbox.addEventListener('change', (e) => {
      if (isUpdatingFromWS) return;
      if (e.target.checked) {
        const azVal = parseInt(azMstep ? azMstep.value : 0);
        const altVal = parseInt(altMstep ? altMstep.value : 0);
        if (azVal >= 64 || altVal >= 64) {
          showModal('Action Blocked', 'Cannot enable Hardlimit when Microsteps are >= 64.<br>Please lower Microsteps to 16 or 32 first.', [{ text: 'OK', class: 'btn-primary' }]);
          e.target.checked = false;
        }
      }
    });
  }
}

// ===== COLLAPSIBLE PANELS =====
function initCollapsibles() {
  const headers = document.querySelectorAll('.panel-header');
  
  headers.forEach(header => {
    const panel = header.closest('.panel');
    if (!panel) return;
    
    const panelId = panel.id;
    
    // Restore state from localStorage
    if (panelId) {
      const isCollapsed = localStorage.getItem('panel_collapsed_' + panelId) === 'true';
      if (isCollapsed) {
        panel.classList.add('collapsed');
      }
    }

    header.addEventListener('click', (e) => {
      // Chỉ ẩn/hiện panel khi click vào khu vực mũi tên (.toggle-icon)
      if (!e.target.closest('.toggle-icon')) return;
      
      panel.classList.toggle('collapsed');
      
      // Save state
      if (panelId) {
        localStorage.setItem('panel_collapsed_' + panelId, panel.classList.contains('collapsed'));
      }
    });
  });
}

// ===== INITIALIZATION =====
window.addEventListener('load', () => {
  // Ngăn trình duyệt tự động khôi phục vị trí cuộn cũ
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  
  // Lấy phiên bản SPIFFS hiện tại từ HTML khi load trang
  const spEl = document.getElementById('display-spiffs-ver');
  if (spEl) {
    const text = spEl.textContent;
    currentSpiffsVer = extractVersion(text);
    spEl.textContent = "spiffs " + currentSpiffsVer; // Đồng bộ định dạng hiển thị
  }

  window.scrollTo(0, 0);
  setTimeout(() => {
    window.scrollTo(0, 0);
  }, 50);
  connectWebSocket();
  initChart();
  initTheme(); // Khởi tạo theme
  initCollapsibles(); // Init panels
  initControlMode(); // Init control mode
  initMotorModeChangeHandlers(); // Logic SpreadCycle -> Disable Hardlimit

  // Tự động trả về giới hạn cho max-speed
  const maxSpeedInput = document.getElementById('max-speed');
  if (maxSpeedInput) {
    maxSpeedInput.addEventListener('change', (e) => {
      let val = parseFloat(e.target.value);
      if (val < 50) e.target.value = 50;
      if (val > 400) e.target.value = 400;
    });
  }
  
  // Không load từ localStorage nữa, đợi WebSocket gửi speedLevel từ ESP32 về
  // để đảm bảo đồng bộ với thiết bị.
  
  // Update system info
  const uptime = '0h 0m';
  const fram = '0KB / 32KB';
  const sysInfo = document.getElementById('system-info');
  if (sysInfo) {
    sysInfo.textContent = `Uptime: ${uptime} | FRAM: ${fram}`;
  }
});

// ===== STATUS LINK TO LOG =====
const statusLink = document.getElementById('status-link');
if (statusLink) {
  statusLink.addEventListener('click', () => {
    const logSection = document.getElementById('log-panel-section');
    const controlTabBtn = document.querySelector('.tab-btn[data-tab="control"]');
    const controlTabContent = document.getElementById('control-tab');
    const configTabBtn = document.querySelector('.tab-btn[data-tab="config"]');
    const configTabContent = document.getElementById('config-tab');

    // Switch to Control tab if not active
    if (controlTabBtn && controlTabContent && !controlTabContent.classList.contains('active')) {
      if(configTabContent) configTabContent.classList.remove('active');
      if(configTabBtn) configTabBtn.classList.remove('active');
      
      controlTabContent.classList.add('active');
      controlTabBtn.classList.add('active');
    }

    // Scroll to log section after a short delay to allow tab to render
    if (logSection) {
      setTimeout(() => {
        logSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50); 
    }
  });
}
// ===== KEYBOARD CONTROLS =====
document.addEventListener('keydown', (e) => {
  // Nếu đang nhập liệu (input/textarea) thì không xử lý phím tắt (để gõ được dấu cách)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const speedLevel = document.querySelector('.speed-btn.active').dataset.level;
  
  switch(e.key) {
    case 'ArrowUp':
      sendCommand('move', { axis: 'alt', direction: 1, speed: speedLevel });
      e.preventDefault();
      break;
    case 'ArrowDown':
      sendCommand('move', { axis: 'alt', direction: -1, speed: speedLevel });
      e.preventDefault();
      break;
    case 'ArrowLeft':
      sendCommand('move', { axis: 'az', direction: -1, speed: speedLevel });
      e.preventDefault();
      break;
    case 'ArrowRight':
      sendCommand('move', { axis: 'az', direction: 1, speed: speedLevel });
      e.preventDefault();
      break;
    case ' ':
      sendCommand('stop', {});
      e.preventDefault();
      break;
  }
});

document.addEventListener('keyup', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    sendCommand('stop', {});
  }
});

// Prevent context menu (long press)
document.addEventListener('contextmenu', (e) => {
  // Allow context menu on inputs
  if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
  }
});

let panelWheelLock = false;
let panelWheelAccum = 0;
let panelWheelResetTimer = null;
const PANEL_WHEEL_SNAP_THRESHOLD = 220;

function getActivePanels() {
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab) return [];
  return Array.from(activeTab.querySelectorAll('.panel')).filter((panel) => !panel.classList.contains('hidden'));
}

function scrollToAdjacentPanel(direction) {
  const panels = getActivePanels();
  if (!panels.length) return;

  const header = document.querySelector('.header');
  const stickyOffset = (header ? header.offsetHeight : 0) + 8;
  const currentTop = window.scrollY + stickyOffset;

  let currentIndex = 0;
  for (let i = 0; i < panels.length; i++) {
    if (panels[i].offsetTop <= currentTop) {
      currentIndex = i;
    } else {
      break;
    }
  }

  const nextIndex = Math.max(0, Math.min(panels.length - 1, currentIndex + direction));
  if (nextIndex === currentIndex) return;

  panels[nextIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Mouse wheel: small movement scrolls normally, strong movement snaps to next/previous panel
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault(); // Prevent Ctrl+Wheel Zoom
    return;
  }

  if (e.target.tagName === 'INPUT') {
    e.preventDefault();
    return;
  }

  // Keep native wheel behavior in internal scroll containers.
  if (e.target.closest('.history-list, .wifi-list, .modal-body')) {
    return;
  }

  if (panelWheelLock) {
    e.preventDefault();
    return;
  }

  if (Math.abs(e.deltaY) < 8) {
    return;
  }

  panelWheelAccum += e.deltaY;
  if (panelWheelResetTimer) clearTimeout(panelWheelResetTimer);
  panelWheelResetTimer = setTimeout(() => {
    panelWheelAccum = 0;
    panelWheelResetTimer = null;
  }, 180);

  if (Math.abs(panelWheelAccum) < PANEL_WHEEL_SNAP_THRESHOLD) {
    return;
  }

  e.preventDefault();
  panelWheelLock = true;
  const direction = panelWheelAccum > 0 ? 1 : -1;
  panelWheelAccum = 0;
  scrollToAdjacentPanel(direction);

  setTimeout(() => {
    panelWheelLock = false;
  }, 420);
}, { passive: false });

// Prevent Pinch Zoom (Mobile)
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) {
    e.preventDefault();
  }
}, { passive: false });

// Prevent negative input on DMS fields
document.querySelectorAll('.dms-field').forEach(input => {
  input.addEventListener('input', (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) return; // Cho phép xóa trống
    
    if (val < 0) val = Math.abs(val);
    
    const max = parseInt(e.target.getAttribute('max'));
    if (!isNaN(max) && val > max) val = max;
    
    e.target.value = val;
  });
});
