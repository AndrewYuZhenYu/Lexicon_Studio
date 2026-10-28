# Lexicon Studio

多彩词汇解析 v10 的 GitHub Pages 上线文件夹。网站入口是仓库根目录的 `index.html`；本文件夹只保留这一个 HTML 文件。

## 部署到 GitHub Pages

1. 将本文件夹作为 Git 仓库上传到 GitHub。
2. 在仓库 **Settings → Pages** 中选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`。
3. 等待 GitHub Pages 发布，打开它给出的站点地址。

页面的 CSS、JavaScript 和图标都内嵌在 `index.html`，不需要构建步骤或安装依赖。

## API 使用说明

首次查询时，使用者须在页面中输入自己的 DeepSeek API Key。密钥只保存在当前标签页的 `sessionStorage` 中；请不要把密钥写入 `index.html` 或提交到 Git 仓库。GitHub Pages 只能托管静态文件，不能运行原开发项目中的 `server.js` 本地代理。在 Pages 上，页面会从浏览器直连 DeepSeek；如果浏览器或网络阻止跨域请求，查询会失败，需要另外部署可供此站点访问的 API 代理。页面静态界面仍可正常加载。

## 更新约定

本目录是“上线文件夹”。日常开发继续在原项目 `/Users/andrewyu/WebstormProjects/dictionary_API` 中进行；只有确认上线后，才把获准发布的版本复制到这里并命名为 `index.html`。
