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

// Chart Variables
let sgChartCtx = null;
const sgHistoryLength = 100;
let lastCalibData = null; // Lưu kết quả calib tạm thời
let sgDataAz = new Array(sgHistoryLength).fill(0);
let sgDataAlt = new Array(sgHistoryLength).fill(0);
let csDataAz = new Array(sgHistoryLength).fill(0);
let csDataAlt = new Array(sgHistoryLength).fill(0);

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

  modalTitle.textContent = displayTitle;
  modalBody.innerHTML = content;
  modalFooter.innerHTML = '';

  buttons.forEach(btnInfo => {
    const button = document.createElement('button');
    button.textContent = btnInfo.text;
    button.className = `btn ${btnInfo.class || 'btn-secondary'}`;
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
  if (modal) modal.style.display = 'none';
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + window.location.host + '/ws');
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    // Trạng thái sẽ được cập nhật khi nhận gói tin đầu tiên chứa RSSI
    if (reconnectInterval) clearInterval(reconnectInterval);
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateUI(data);
    } catch (e) {
      console.error('JSON parse error:', e);
    }
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateWifiIcon(-1000); // Hiển thị mất kết nối
  };
  
  ws.onclose = () => {
    console.log('WebSocket closed');
    updateWifiIcon(-1000); // Hiển thị mất kết nối
    // Attempt reconnect every 3 seconds
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
      showMessage('Settings saved on device', '#save-message', 3000);
    }
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

  // Cập nhật trạng thái Calib để khóa nút
  if (data.isCalibrating !== undefined) {
    isSystemCalibrating = data.isCalibrating;
    setSystemLocked(hasSystemError || isSystemCalibrating);
  }
  
  // Cập nhật thông tin phiên bản từ Server
  if (data.fw_ver !== undefined) {
    // Lưu "1.0.7" để so sánh nhưng hiển thị đầy đủ "firmware 1.0.7"
    currentFwVer = extractVersion(data.fw_ver);
    const el = document.getElementById('display-fw-ver');
    if (el) el.textContent = data.fw_ver;
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
    isUpdatingFromWS = false;
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
    const bar = document.getElementById('ota-progress-bar');
    const text = document.getElementById('ota-percent');
    if (bar) bar.style.width = percent + '%';
    if (text) text.textContent = percent + '%';

    if (percent === 100) {
      const label = document.getElementById('ota-status-label');
      if (label) label.textContent = "Update Successful! Rebooting...";
      setTimeout(() => {
        window.location.reload();
      }, 5000); // Đợi 5 giây để ESP32 khởi động lại và Web Server sẵn sàng
    }
  }

  // Xử lý khi OTA thất bại
  if (data.ota_status === "FAILED") {
    const container = document.getElementById('ota-progress-container');
    if (container) container.classList.add('hidden');
  }

  // Xử lý log từ server
  if (data.log !== undefined) {
    appendLog(data.log);
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
      show_hardlimit_monitor: document.getElementById('show-hardlimit-monitor').checked
    },
    backlash: {
      enable: document.getElementById('enable-backlash').checked,
      az_steps: parseInt(document.getElementById('backlash-az').value),
      alt_steps: parseInt(document.getElementById('backlash-alt').value)
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

// ===== CONFIG SAVE =====
const saveAllBtn = document.getElementById('save-all-btn');
if(saveAllBtn) saveAllBtn.addEventListener('click', () => {
  const config = collectConfig();
  
  sendCommand('saveConfig', config);
  setRebootingStatus();
  toggleStepsDisplay(config.motor.show_steps); // Cập nhật hiển thị ngay lập tức
  toggleMonitorPanel(config.motor.show_hardlimit_monitor);
  
  let countdown = 3;
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
            let countdown = 3;
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

// ===== STOP CALIB BUTTON =====
const stopCalibBtn = document.getElementById('stop-calib-btn');
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
  const now = new Date();
  const time = now.toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'history-entry';
  
  // Chuẩn bị nội dung text
  let fullText = `[${time}] ${message}`;
  
  // Tô màu log dựa trên từ khóa
  if (message.includes("Reset by User")) {
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

const resetErrorBtn = document.getElementById('reset-error-btn');
if(resetErrorBtn) resetErrorBtn.addEventListener('click', () => {
  sendCommand('resetError', {});
});

const clearLogBtn = document.getElementById('clear-log-btn');
if(clearLogBtn) clearLogBtn.addEventListener('click', () => {
  const logContainer = document.getElementById('system-log');
  if(logContainer) logContainer.innerHTML = '<div class="history-empty">Waiting for logs...</div>';
});

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
const UPDATE_LINKS = {
  // Sử dụng link raw trực tiếp để tránh redirect HTTPS gây tốn RAM
  firmware: "https://raw.githubusercontent.com/MLAstroRPA/Update/main/firmware.bin",
  spiffs: "https://raw.githubusercontent.com/MLAstroRPA/Update/main/spiffs.bin"
};

async function checkAllUpdates() {
  const repoOwner = "MLAstroRPA";
  const repoName = "Update";
  const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/`;

  showModal('Checking Updates', `<div class="wifi-scanning">Connecting to GitHub...</div>`);

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Failed to reach GitHub");
    const files = await response.json();

    // Lọc tất cả các file .bin
    const binFiles = files.filter(f => f.name.toLowerCase().endsWith('.bin'));

    if (binFiles.length === 0) {
      showModal('No Updates', 'No update files (.bin) found in the repository.');
      return;
    }

    // Sắp xếp phiên bản mới nhất lên đầu
    binFiles.sort((a, b) => b.name.localeCompare(a.name));

    let html = `<p style="margin-bottom:15px;">Select a version to install:</p><div style="max-height: 300px; overflow-y: auto;">`;
    binFiles.forEach((file, i) => {
      const isFw = file.name.toLowerCase().includes('firmware');
      const isSp = file.name.toLowerCase().includes('spiffs');
      const typeTag = isFw ? '<span style="color:var(--primary)">[FW]</span>' : (isSp ? '<span style="color:var(--success)">[DATA]</span>' : '[??]');
      
      html += `
        <label class="checkbox-label" style="display:flex; align-items:center; padding:12px; border-bottom:1px solid var(--border); cursor:pointer;">
          <input type="radio" name="update-file" value="${file.download_url}" data-filename="${file.name}" ${i === 0 ? 'checked' : ''}>
          <div style="margin-left:10px;">
            <div style="font-weight:bold;">${typeTag} ${file.name}</div>
            <div style="font-size:11px; color:var(--text-muted);">Size: ${(file.size / 1024).toFixed(1)} KB</div>
          </div>
        </label>`;
    });
    html += `</div>`;

    showModal('Available Updates', html, [
      { text: 'START UPDATE', class: 'btn-danger', closeOnClick: false, callback: () => {
        const selected = document.querySelector('input[name="update-file"]:checked');
        const url = selected.value;
        const fname = selected.getAttribute('data-filename').toLowerCase();
        const type = fname.includes('spiffs') ? 'spiffs' : 'firmware';
        
        // KIỂM TRA PHIÊN BẢN TRÙNG LẶP (SỬ DỤNG HELPER MỚI)
        const selectedVer = extractVersion(fname);
        
        if (selectedVer !== "unknown") {
            const currentVer = (type === 'firmware') ? currentFwVer : currentSpiffsVer;
            
            if (selectedVer === currentVer) {
                showModal('Update Blocked', `<strong>THIS UPDATE IS IN USED</strong><br><br>The system is already running ${type} version ${selectedVer}.`, [{ text: 'OK' }]);
                return;
            }
        }

        hideModal(); // Chỉ đóng modal khi thực sự tiến hành OTA
        startOTA(type, url);
      }},
      { text: 'Cancel' }
    ]);
  } catch (err) {
    showModal('Error', `GitHub API Error: ${err.message}`, [{ text: 'OK' }]);
  }
}

function startOTA(type, url) {
  const progressContainer = document.getElementById('ota-progress-container');
  if (progressContainer) progressContainer.classList.remove('hidden');
  document.getElementById('ota-status-label').textContent = `Updating ${type}...`;
  document.getElementById('ota-progress-bar').style.width = '0%';
  document.getElementById('ota-percent').textContent = '0%';
  sendCommand('otaUpdate', { type: type, url: url });
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
      // Prevent collapse when clicking buttons inside header (like in Log panel)
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      
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
  
  // Move Force Stop button to Header (before Status)
  const forceStopBtn = document.getElementById('btn-force-stop');
  const headerStatus = document.querySelector('.header-status');
  if (forceStopBtn && headerStatus) {
    headerStatus.insertBefore(forceStopBtn, headerStatus.firstChild);
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

// Block mouse wheel on all inputs
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault(); // Prevent Ctrl+Wheel Zoom
  }
  if (e.target.tagName === 'INPUT') {
    e.preventDefault();
  }
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
