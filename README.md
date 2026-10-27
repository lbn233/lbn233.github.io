# 思维练习 OJ

题库网站：https://lbn233.github.io/

这是一个个人算法练习站，包含二分答案和分治题。网站由 GitHub Pages 提供；代码在当前电脑的 WSL 中编译和评测，不发送到第三方评测服务。

## 评测机

在安装了 Python 3、g++、bubblewrap 和 prlimit 的 Ubuntu WSL 中，进入本仓库目录并运行：

```sh
python3 judge-server.py
```

在 Windows 中，也可以从仓库目录运行 `powershell -NoProfile -File .\start-judge.ps1`，由脚本启动 Ubuntu WSL 中的评测机。

评测机只监听本机 `127.0.0.1:8766`。打开题库后，页面会检测本机评测机；如浏览器请求本地网络访问权限，请按浏览器提示操作。换一台电脑使用题库时，需在那台电脑上启动评测机。

评测使用 bubblewrap 隔离编译和运行，并设置时间、输出和资源限制。测试数据随仓库公开，适合个人练习，不是隐藏测试或比赛防作弊系统。

## 更新题目

- `problems.json` 保存题目、输入输出格式和公开样例。
- `tests.json` 按题目编号保存评测数据；修改题目时请同步更新测试点和标准输出。
- `judge-server.py` 是本机评测服务，`index.html`、`style.css`、`app.js` 和 `judge.js` 是网页文件。

将更新提交到本仓库的 `main` 分支后，GitHub Pages 会重新发布网页。在本机工作副本中同步更新并重启评测服务，才能让本机判题使用更新后的测试数据。
