/* content/unlock.js
 * 尽早解除网页对文字选择、复制和右键菜单的常见限制。
 */
(() => {
  if (!window.SelectionFeature) return;

  const controller = window.SelectionFeature.createUnlockController(document, window);
  const apply = (settings) => {
    if (window.SelectionFeature.isUnlockEnabled(settings)) controller.enable();
    else controller.disable();
  };

  // 默认开启：同步安装可抢在页面脚本之前；若用户已关闭，读取设置后立即撤销。
  controller.enable();
  chrome.storage.local.get(['settings']).then(({ settings }) => apply(settings)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) apply(changes.settings.newValue);
  });
})();
