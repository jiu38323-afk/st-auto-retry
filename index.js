/**
 * Auto Retry - 截断/空回自动重试插件
 * by Elvis & 小九
 * v1.0.0
 *
 * 检测AI回复截断或空回，自动静默触发重新生成。
 * 安装路径：SillyTavern/public/scripts/extensions/third-party/auto-retry/
 */

import { extension_settings, getContext } from '../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

const EXT_NAME = 'auto-retry';

// ========== 默认设置 ==========
const DEFAULTS = {
    enabled: true,
    detectEmpty: true,       // 检测空回
    detectTruncation: true,  // 检测截断
    maxRetries: 3,           // 最大重试次数
    retryDelay: 1500,        // 重试前等待（ms）
    minLength: 5,            // 少于这个字数视为空回
};

// ========== 运行状态 ==========
let retryCount = 0;
let isRetrying = false;
let lastChatLength = 0;

// ========== 检测逻辑 ==========

/**
 * 检测空回
 */
function isEmptyResponse(text) {
    if (!text) return true;
    const cleaned = text.replace(/\s/g, '');
    return cleaned.length < (extension_settings[EXT_NAME]?.minLength ?? DEFAULTS.minLength);
}

/**
 * 检测截断
 * 思路：正常结束的回复应该以完整标点/闭合标记结尾
 */
function isTruncatedResponse(text) {
    if (!text || text.trim().length === 0) return false;

    const trimmed = text.trim();

    // 太短的回复走空回检测，不走截断
    if (trimmed.length < 20) return false;

    // ---- 检查未闭合的代码块 ----
    const codeBlockCount = (trimmed.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) return true;

    // ---- 检查末尾字符 ----
    // 获取最后一个非空白字符
    const lastChar = trimmed.slice(-1);

    // 正常结束的标点/标记
    const validEndings = [
        // 中文标点
        '。', '！', '？', '…', '」', '』', '）', '】', '》',
        '"', ''', '；', '：', '、', '，',
        // 英文标点
        '.', '!', '?', ')', ']', '}', '"', "'", ';', ':',
        // RP / Markdown 标记
        '*', '~', '_', '-',
        // 列表/分隔
        '|',
    ];

    if (validEndings.includes(lastChar)) return false;

    // 如果末尾是字母/汉字/数字但没有标点，可能是截断
    // 但也可能是正常结尾（比如角色名、单词结尾）
    // 加一个长度门槛：回复超过100字符且末尾无标点 → 大概率截断
    if (trimmed.length > 100) {
        console.log(`[Auto-Retry] 疑似截断 — 末尾字符: "${lastChar}"，总长度: ${trimmed.length}`);
        return true;
    }

    return false;
}

// ========== 重试逻辑 ==========

/**
 * 触发重新生成（swipe优先，fallback到regenerate）
 */
function triggerRegenerate() {
    try {
        // 方式1：swipe（生成新的备选回复）
        const swipeBtn = document.getElementById('swipe_right');
        if (swipeBtn && swipeBtn.offsetParent !== null) {
            swipeBtn.click();
            return true;
        }

        // 方式2：jQuery选择器
        const $swipe = $('#swipe_right');
        if ($swipe.length > 0 && $swipe.is(':visible')) {
            $swipe.trigger('click');
            return true;
        }

        // 方式3：regenerate按钮
        const $regen = $('#option_regenerate');
        if ($regen.length > 0) {
            $regen.trigger('click');
            return true;
        }

        console.warn('[Auto-Retry] 找不到重新生成按钮');
        return false;
    } catch (err) {
        console.error('[Auto-Retry] 触发重新生成失败:', err);
        return false;
    }
}

/**
 * 生成结束时的回调
 */
async function onGenerationEnded() {
    const settings = extension_settings[EXT_NAME];
    if (!settings?.enabled) return;

    const context = getContext();
    const chat = context?.chat;
    if (!chat || chat.length === 0) return;

    const lastMessage = chat[chat.length - 1];

    // 只检查AI回复
    if (lastMessage.is_user) {
        retryCount = 0;
        isRetrying = false;
        return;
    }

    // 新的对话轮次 → 重置计数
    if (chat.length !== lastChatLength) {
        retryCount = 0;
        isRetrying = false;
        lastChatLength = chat.length;
    }

    // 超过最大重试次数 → 放弃
    if (retryCount >= settings.maxRetries) {
        console.log(`[Auto-Retry] 已重试 ${retryCount} 次，放弃`);
        retryCount = 0;
        isRetrying = false;
        return;
    }

    const text = lastMessage.mes || '';
    let shouldRetry = false;
    let reason = '';

    // 检测空回
    if (settings.detectEmpty && isEmptyResponse(text)) {
        shouldRetry = true;
        reason = '空回复';
    }

    // 检测截断
    if (!shouldRetry && settings.detectTruncation && isTruncatedResponse(text)) {
        shouldRetry = true;
        reason = '截断';
    }

    if (shouldRetry) {
        retryCount++;
        isRetrying = true;
        console.log(`[Auto-Retry] 检测到「${reason}」→ 第 ${retryCount}/${settings.maxRetries} 次重试`);

        setTimeout(() => {
            triggerRegenerate();
        }, settings.retryDelay);
    } else {
        // 正常回复，重置
        if (isRetrying) {
            console.log(`[Auto-Retry] 重试成功，恢复正常`);
        }
        retryCount = 0;
        isRetrying = false;
    }
}

// ========== 设置面板 ==========

function addSettingsUI() {
    const html = `
    <div id="auto-retry-settings" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Auto Retry (自动重试)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="auto_retry_enabled" type="checkbox" />
                    <span>启用自动重试</span>
                </label>
                <label class="checkbox_label">
                    <input id="auto_retry_empty" type="checkbox" />
                    <span>检测空回复</span>
                </label>
                <label class="checkbox_label">
                    <input id="auto_retry_truncation" type="checkbox" />
                    <span>检测截断</span>
                </label>
                <div class="flex-container">
                    <label for="auto_retry_max">最大重试次数</label>
                    <input id="auto_retry_max" type="number" min="1" max="10" step="1" style="width:60px" />
                </div>
                <div class="flex-container">
                    <label for="auto_retry_delay">重试延迟 (ms)</label>
                    <input id="auto_retry_delay" type="number" min="500" max="10000" step="100" style="width:80px" />
                </div>
                <div class="flex-container">
                    <label for="auto_retry_minlen">空回阈值 (字数)</label>
                    <input id="auto_retry_minlen" type="number" min="0" max="50" step="1" style="width:60px" />
                </div>
            </div>
        </div>
    </div>`;

    // 把设置面板插到扩展设置区域
    $('#extensions_settings').append(html);

    // 绑定事件
    const s = extension_settings[EXT_NAME];

    $('#auto_retry_enabled').prop('checked', s.enabled).on('change', function () {
        s.enabled = this.checked;
        saveSettingsDebounced();
    });
    $('#auto_retry_empty').prop('checked', s.detectEmpty).on('change', function () {
        s.detectEmpty = this.checked;
        saveSettingsDebounced();
    });
    $('#auto_retry_truncation').prop('checked', s.detectTruncation).on('change', function () {
        s.detectTruncation = this.checked;
        saveSettingsDebounced();
    });
    $('#auto_retry_max').val(s.maxRetries).on('input', function () {
        s.maxRetries = parseInt(this.value) || DEFAULTS.maxRetries;
        saveSettingsDebounced();
    });
    $('#auto_retry_delay').val(s.retryDelay).on('input', function () {
        s.retryDelay = parseInt(this.value) || DEFAULTS.retryDelay;
        saveSettingsDebounced();
    });
    $('#auto_retry_minlen').val(s.minLength).on('input', function () {
        s.minLength = parseInt(this.value) || DEFAULTS.minLength;
        saveSettingsDebounced();
    });
}

// ========== 初始化 ==========

jQuery(async () => {
    // 加载/初始化设置
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    Object.keys(DEFAULTS).forEach(key => {
        if (extension_settings[EXT_NAME][key] === undefined) {
            extension_settings[EXT_NAME][key] = DEFAULTS[key];
        }
    });

    // 注入设置面板
    addSettingsUI();

    // 监听生成结束事件
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    console.log('[Auto-Retry] ✔ 插件已加载');
});
