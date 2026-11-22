@echo off
rem 启动 Dimlu 低代码编辑器最终版本（生产构建预览）
rem 构建产物位于 dist-release；如需重新构建，先运行:
rem   npm run build -- --outDir dist-release
start "Dimlu Preview" /min cmd /c "node node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4173 --strictPort --outDir dist-release"
start http://127.0.0.1:4173/editor/page/purchases
echo 最终版本已启动: http://127.0.0.1:4173/editor/page/purchases
