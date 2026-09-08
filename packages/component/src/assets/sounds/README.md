# Sound Assets

Notification sound effects.

## Files

- `message.mp3` — 新消息提示音（880Hz 短促提示音，300ms）
- `complete.mp3` — 任务完成提示音（660Hz → 880Hz 上行双音，300ms）
- `error.mp3` — 错误提示音（330Hz 低沉警示音，300ms）

## Specification

- 格式：MP3, 128kbps, 44.1kHz
- 时长：300ms
- 文件大小：~6KB each

## Notes

当前为 ffmpeg 生成的占位音效（正弦波）。后续可替换为设计师制作的正式音效，保持相同的文件名和规格即可。

在音效文件缺失时，通知系统会优雅降级：
- 声音功能静默失败（`HTMLAudioElement` 加载错误被捕获并记录）
- Toast 通知和图标动画不受影响
