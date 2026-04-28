/**
 * Auto Retry - 截断/空回自动重试插件
 * by Elvis & 小九
 * v1.1.0 — 修复导入路径
 *
 * 检测AI回复截断或空回，自动静默触发重新生成。
 */

// ========== 导入 ==========
// 路径: third-party/st-auto-retry/index.js → scripts/extensions.js
import { extension_settings, getContext } from '../../../extensions.js';
// 路径: third-party/st-auto-retry/index.js → public/script.js
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

const EXT_NAME = 'auto-retry';

// ========== 默认设置 ==========
const DEFAULTS = {
    enabled: true,
    detectEmpty: true,
    detectTruncation: true,
    maxRetries: 3,
    retryDelay: 1500,
    minLength: 5,
};

// ========== 运行状态 ==========
let retryCount = 0;
let isRetrying = false;
let lastChatLength = 0;

// ========== 设置管理 ==========
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

    // 未闭合的代码块
    if ((trimmed.match(/```/g) || []).length % 2 !== 0) return true;

    // 末尾字符检查
    const lastChar = trimmed.slice(-1);
    const okEndings = '。！？…」』）】》"\'；：、，.!?)]}\'"*~_-|,;:';

    if (okEndings.includes(lastChar)) return false;

    // 超过100字且末尾不是正常标点 → 大概率截断
    if (trimmed.length > 100) {
        console.log(`[Auto-Retry] 疑似截断 — 末尾:"${lastChar}" 长度:${trimmed.length}`);
        return true;
    }

    return false;
}

// ========== 重试逻辑 ==========

function doRetry() {
    try {
        // 优先 swipe
        const el = document.getElementById('swipe_right')
            || document.querySelector('.swipe_right');
        if (el) { el.click(); return true; }

        // 次选 jQuery
        const $s = jQuery('#swipe_right');
        if ($s.length) { $s.trigger('click'); return true; }

        // 最后 regenerate
        const $r = jQuery('#option_regenerate');
        if ($r.length) { $r.trigger('click'); return true; }

        console.warn('[Auto-Retry] 找不到重试按钮');
        return false;
    } catch (e) {
        console.error('[Auto-Retry] 重试失败:', e);
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

    // 新一轮对话 → 重置
    if (chat.length !== lastChatLength) {
        retryCount = 0;
        isRetrying = false;
        lastChatLength = chat.length;
    }

    if (retryCount >= settings.maxRetries) {
        console.log(`[Auto-Retry] 已达上限 ${retryCount} 次，停止`);
        retryCount = 0;
        isRetrying = false;
        return;
    }

    const text = last.mes || '';
    let reason = '';

    if (settings.detectEmpty && isEmptyResponse(text)) {
        reason = '空回复';
    } else if (settings.detectTruncation && isTruncatedResponse(text)) {
        reason = '截断';
    }

    if (reason) {
        retryCount++;
        isRetrying = true;
        console.log(`[Auto-Retry] 检测到「${reason}」→ 第${retryCount}/${settings.maxRetries}次重试`);
        setTimeout(doRetry, settings.retryDelay);
    } else {
        if (isRetrying) console.log('[Auto-Retry] 重试成功');
        retryCount = 0;
        isRetrying = false;
    }
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
            </div>
        </div>
    </div>`;

    // 尝试插入到扩展设置区域
    const $target = jQuery('#extensions_settings2, #extensions_settings').first();
    if ($target.length) {
        $target.append(html);
    } else {
        // fallback: 插到 #top-settings-holder
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
}

// ========== 初始化 ==========

jQuery(async () => {
    getSettings();
    addUI();
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    console.log('[Auto-Retry] ✔ v1.1.0 已加载');
});
