import { defineConfig } from 'vite';

export default defineConfig({
  root: 'assets', // エントリーポイントを src フォルダに設定
  optimizeDeps: {
    include: ["@google/generative-ai"], // 必要に応じて明示的に追加
  },
  build: {
    outDir: '../dist', // ビルド出力先
    assetsDir: 'assets', // 静的ファイルのディレクトリ
    sourcemap: true, // デバッグ用にソースマップを出力
  },
});
