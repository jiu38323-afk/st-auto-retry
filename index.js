/**
 * Auto Retry - 截断/空回自动重试插件
 * by Elvis
 * v1.3.0 — 自定义结束标记 + 改进截断检测
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
    endMarker: '>',       // 自定义结束标记，大部分预设/角色卡以 > 结尾
    markerSearchRange: 100, // 在末尾多少字符内搜索标记
};

let retryCount = 0;
let isRetrying = false;
let lastChatLength = 0;
let manualStop = false;  // 手动停止标记，跳过下一次检测

// ========== 工具 ==========

function toast(msg, type = 'info') {
    if (typeof toastr !== 'undefined') toastr[type](msg, 'Auto Retry');
    console.log(`[Auto-Retry] ${msg}`);
}

function getSettings() {
    if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
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

/**
 * 截断检测
 * 模式A（有结束标记）：末尾N字符内是否包含标记
 * 模式B（无结束标记）：末尾标点判断
 */
function isTruncatedResponse(text) {
    if (!text || text.trim().length < 20) return false;
    const trimmed = text.trim();
    const s = getSettings();

    // ---- 模式A：自定义结束标记 ----
    if (s.endMarker && s.endMarker.trim()) {
        const marker = s.endMarker.trim();
        if (!trimmed.endsWith(marker)) {
            console.log(`[Auto-Retry] 末尾不是「${marker}」→ 截断`);
            return true;
        }
        return false;
    }

    // ---- 模式B：标点检测（fallback）----
    // 未闭合代码块
    if ((trimmed.match(/```/g) || []).length % 2 !== 0) return true;

    const lastChar = trimmed.slice(-1);
    // 注意：逗号「，」和顿号「、」不算正常结尾——以这些结尾大概率是截断
    const okEndings = '。！？…」』）】》"\'；.!?)]}\'"*~_-|;:';
    if (okEndings.includes(lastChar)) return false;

    // 超过100字且末尾不是正常标点
    if (trimmed.length > 100) {
        console.log(`[Auto-Retry] 疑似截断 — 末尾:"${lastChar}" 长度:${trimmed.length}`);
        return true;
    }
    return false;
}

function detectProblem(text) {
    const s = getSettings();
    if (s.detectEmpty && isEmptyResponse(text)) return '空回复';
    if (s.detectTruncation && isTruncatedResponse(text)) return '截断';
    return null;
}

// ========== 重试 ==========

function doRetry() {
    try {
        // 优先用SillyTavern内部API（最可靠）
        const context = getContext();
        if (typeof context.swipe_right === 'function') {
            context.swipe_right();
            return true;
        }

        // fallback: DOM按钮
        const $s = jQuery('#swipe_right');
        if ($s.length) { $s.trigger('click'); return true; }
        const $r = jQuery('#option_regenerate');
        if ($r.length) { $r.trigger('click'); return true; }

        toast('找不到重试方式', 'warning');
        return false;
    } catch (e) {
        toast('重试失败: ' + e.message, 'error');
        return false;
    }
}

function onGenerationEnded() {
    const settings = getSettings();
    if (!settings.enabled) return;

    // 手动停止的回复不检测
    if (manualStop) {
        manualStop = false;
        retryCount = 0;
        isRetrying = false;
        return;
    }

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

// ========== 测试 ==========

function testDetection() {
    const context = getContext();
    const chat = context?.chat;
    if (!chat || chat.length === 0) { toast('没有聊天记录', 'warning'); return; }

    const last = chat[chat.length - 1];
    if (last.is_user) { toast('最后一条是用户消息', 'warning'); return; }

    const text = last.mes || '';
    const problem = detectProblem(text);
    const tail = text.trim().slice(-30);

    if (problem) {
        toast(`检测结果：「${problem}」✗\n末尾："${tail}"`, 'warning');
    } else {
        toast(`检测结果：正常 ✓\n末尾："${tail}"`, 'success');
    }
}

function testSwipe() {
    toast('手动触发swipe...', 'info');
    if (doRetry()) toast('swipe已触发！', 'success');
}

// ========== UI ==========

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
                <div style="margin:6px 0">
                    <label style="display:block;margin-bottom:2px">结束标记（填你预设/角色卡的结束符号）</label>
                    <input id="ar_marker" type="text" placeholder="如 > 或 --> 留空则用自动检测" style="width:100%;box-sizing:border-box" />
                    <small style="opacity:0.6">回复末尾没有这个标记 = 截断。留空则按标点自动判断。</small>
                </div>
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
    if ($target.length) $target.append(html);
    else jQuery('#top-settings-holder').append(html);

    const s = getSettings();

    jQuery('#ar_enabled').prop('checked', s.enabled).on('change', function () {
        s.enabled = this.checked; saveSettingsDebounced();
    });
    jQuery('#ar_empty').prop('checked', s.detectEmpty).on('change', function () {
        s.detectEmpty = this.checked; saveSettingsDebounced();
    });
    jQuery('#ar_trunc').prop('checked', s.detectTruncation).on('change', function () {
        s.detectTruncation = this.checked; saveSettingsDebounced();
    });
    jQuery('#ar_marker').val(s.endMarker).on('input', function () {
        s.endMarker = this.value; saveSettingsDebounced();
    });
    jQuery('#ar_max').val(s.maxRetries).on('input', function () {
        s.maxRetries = parseInt(this.value) || DEFAULTS.maxRetries; saveSettingsDebounced();
    });
    jQuery('#ar_delay').val(s.retryDelay).on('input', function () {
        s.retryDelay = parseInt(this.value) || DEFAULTS.retryDelay; saveSettingsDebounced();
    });

    jQuery('#ar_test_detect').on('click', testDetection);
    jQuery('#ar_test_swipe').on('click', testSwipe);
}

// ========== 初始化 ==========

jQuery(async () => {
    getSettings();
    addUI();
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, () => { manualStop = true; });
    toast('v1.3.0 已加载', 'success');
});
