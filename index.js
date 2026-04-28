/**
 * Auto Retry - 截断/空回自动重试插件
 * by Elvis
 * v1.2.0 — 加测试按钮 + toast提示
 *
 * 检测AI回复截断或空回，自动静默触发重新生成。
 */

import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

const EXT_NAME = 'auto-retry';

const DEFAULTS = {
    enabled: true,
    detectEmpty: true,
    detectTruncation: true,
    maxRetries: 3,
    retryDelay: 1500,
    minLength: 5,
};

let retryCount = 0;
let isRetrying = false;
let lastChatLength = 0;

// ========== 工具函数 ==========

function toast(msg, type = 'info') {
    if (typeof toastr !== 'undefined') {
        toastr[type](msg, 'Auto Retry');
    }
    console.log(`[Auto-Retry] ${msg}`);
}

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    const s = extension_settings[EXT_NAME];
    for (const [key, val] of Object.entries(DEFAULTS)) {
        if (s[key] === undefined) s[key] = val;
    }
    return s;
}

// ========== 检测逻辑 ==========

function isEmptyResponse(text) {
    if (!text) return true;
    return text.replace(/\s/g, '').length < getSettings().minLength;
}

function isTruncatedResponse(text) {
    if (!text || text.trim().length < 20) return false;
    const trimmed = text.trim();

    // 未闭合代码块
    if ((trimmed.match(/```/g) || []).length % 2 !== 0) return true;

    const lastChar = trimmed.slice(-1);
    const okEndings = '。！？…」』）】》"\'；：、，.!?)]}\'"*~_-|,;:';
    if (okEndings.includes(lastChar)) return false;

    if (trimmed.length > 100) return true;

    return false;
}

/**
 * 对一段文本执行检测，返回结果
 */
function detectProblem(text) {
    const s = getSettings();
    if (s.detectEmpty && isEmptyResponse(text)) return '空回复';
    if (s.detectTruncation && isTruncatedResponse(text)) return '截断';
    return null;
}

// ========== 重试逻辑 ==========

function doRetry() {
    try {
        const el = document.getElementById('swipe_right')
            || document.querySelector('.swipe_right');
        if (el) { el.click(); return true; }

        const $s = jQuery('#swipe_right');
        if ($s.length) { $s.trigger('click'); return true; }

        const $r = jQuery('#option_regenerate');
        if ($r.length) { $r.trigger('click'); return true; }

        toast('找不到重试按钮', 'warning');
        return false;
    } catch (e) {
        toast('重试失败: ' + e.message, 'error');
        return false;
    }
}

function onGenerationEnded() {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = getContext();
    const chat = context?.chat;
    if (!chat || chat.length === 0) return;

    const last = chat[chat.length - 1];
    if (last.is_user) { retryCount = 0; isRetrying = false; return; }

    if (chat.length !== lastChatLength) {
        retryCount = 0;
        isRetrying = false;
        lastChatLength = chat.length;
    }

    if (retryCount >= settings.maxRetries) {
        toast(`已重试${retryCount}次，放弃`, 'warning');
        retryCount = 0;
        isRetrying = false;
        return;
    }

    const text = last.mes || '';
    const problem = detectProblem(text);

    if (problem) {
        retryCount++;
        isRetrying = true;
        toast(`检测到「${problem}」→ 第${retryCount}/${settings.maxRetries}次重试`, 'info');
        setTimeout(doRetry, settings.retryDelay);
    } else {
        if (isRetrying) toast('重试成功！', 'success');
        retryCount = 0;
        isRetrying = false;
    }
}

// ========== 测试功能 ==========

function testDetection() {
    const context = getContext();
    const chat = context?.chat;
    if (!chat || chat.length === 0) {
        toast('没有聊天记录', 'warning');
        return;
    }

    const last = chat[chat.length - 1];
    if (last.is_user) {
        toast('最后一条是用户消息，请先让AI回复', 'warning');
        return;
    }

    const text = last.mes || '';
    const problem = detectProblem(text);

    if (problem) {
        toast(`检测结果：「${problem}」✗\n实际使用时会自动重试`, 'warning');
    } else {
        const preview = text.trim().slice(-20);
        toast(`检测结果：正常 ✓\n末尾："${preview}"`, 'success');
    }
}

function testSwipe() {
    toast('手动触发swipe...', 'info');
    const ok = doRetry();
    if (ok) toast('swipe已触发！', 'success');
}

// ========== 设置面板 ==========

function addUI() {
    const html = `
    <div id="auto-retry-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Auto Retry (自动重试)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="ar_enabled" type="checkbox" />
                    <span>启用</span>
                </label>
                <label class="checkbox_label">
                    <input id="ar_empty" type="checkbox" />
                    <span>检测空回复</span>
                </label>
                <label class="checkbox_label">
                    <input id="ar_trunc" type="checkbox" />
                    <span>检测截断</span>
                </label>
                <div style="margin:4px 0">
                    <label>最大重试 <input id="ar_max" type="number" min="1" max="10" style="width:50px" /></label>
                </div>
                <div style="margin:4px 0">
                    <label>延迟(ms) <input id="ar_delay" type="number" min="500" max="10000" step="100" style="width:70px" /></label>
                </div>
                <hr style="margin:8px 0" />
                <div style="display:flex;gap:6px">
                    <button id="ar_test_detect" class="menu_button" style="font-size:12px;padding:4px 8px">
                        🔍 检测当前回复
                    </button>
                    <button id="ar_test_swipe" class="menu_button" style="font-size:12px;padding:4px 8px">
                        🔄 手动触发swipe
                    </button>
                </div>
            </div>
        </div>
    </div>`;

    const $target = jQuery('#extensions_settings2, #extensions_settings').first();
    if ($target.length) {
        $target.append(html);
    } else {
        jQuery('#top-settings-holder').append(html);
    }

    const s = getSettings();

    jQuery('#ar_enabled').prop('checked', s.enabled).on('change', function () {
        s.enabled = this.checked;
        saveSettingsDebounced();
    });
    jQuery('#ar_empty').prop('checked', s.detectEmpty).on('change', function () {
        s.detectEmpty = this.checked;
        saveSettingsDebounced();
    });
    jQuery('#ar_trunc').prop('checked', s.detectTruncation).on('change', function () {
        s.detectTruncation = this.checked;
        saveSettingsDebounced();
    });
    jQuery('#ar_max').val(s.maxRetries).on('input', function () {
        s.maxRetries = parseInt(this.value) || DEFAULTS.maxRetries;
        saveSettingsDebounced();
    });
    jQuery('#ar_delay').val(s.retryDelay).on('input', function () {
        s.retryDelay = parseInt(this.value) || DEFAULTS.retryDelay;
        saveSettingsDebounced();
    });

    // 测试按钮
    jQuery('#ar_test_detect').on('click', testDetection);
    jQuery('#ar_test_swipe').on('click', testSwipe);
}

// ========== 初始化 ==========

jQuery(async () => {
    getSettings();
    addUI();
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    toast('v1.2.0 已加载', 'success');
});
