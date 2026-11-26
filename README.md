# Lexicon Studio · GitHub Pages 上线仓库

这是正式网站的上线文件夹，对应 GitHub 仓库 `AndrewYuZhenYu/Lexicon_Studio`。GitHub Pages 使用仓库根目录的 `index.html` 作为首页。日常开发在 `/Users/andrewyu/WebstormProjects/dictionary_API` 进行。

截至 2026-11-26，本文件夹中的 `index.html` 仍是单独的 v10.5 查词页。带左侧单词表的新双栏版已经打包在 `/Users/andrewyu/WebstormProjects/dictionary_API/site_workspace/dist`，尚未复制到本仓库或推送 GitHub。

## 上线双栏版

1. 先把本文件夹现有的 `index.html` 复制到文件夹外备份。
2. 打开上述 `site_workspace/dist`，**复制里面的全部内容**到本文件夹根目录，同名文件选择替换。不要只复制 `index.html`，也不要把整个 `dist` 文件夹套进来。`vendor` 文件夹及各个 JS 文件都必须一起复制。
3. 在本仓库检查改动，提交并推送到 `main`。GitHub Pages 若仍设置为 `main` 分支的 `/ (root)`，会自动更新原网址；可在仓库的 **Actions** 或 **Settings → Pages** 查看部署结果。
4. 打开原网址检查左侧词表和右侧查词。登录原有 Firebase 账号后，词表、词条修改与标记、收藏、查询历史和解析缓存会从云端恢复。

GitHub Pages 只托管静态文件，不运行开发项目中的 `server.js`。生成新解析仍需使用者在网页中输入自己的 DeepSeek API Key；密钥不会上传到 Firebase，也不要写进仓库。换网址后需要重新输入一次。
