/**
 * fetch-videos.js — yt-dlp 使用、APIキー不要
 *
 * ✅ 中断・再開対応: 途中で止まっても node fetch-videos.js を再実行すれば続きから開始
 * 進捗は data_progress.json に随時保存されます。
 *
 * 使い方:
 *   node fetch-videos.js           # 初回 or 続きから再開
 *   node fetch-videos.js --reset   # 最初からやり直す
 */

const { spawnSync } = require('child_process');
const { execSync }  = require('child_process');
const fs = require('fs');

const CHANNEL_URL = 'https://www.youtube.com/@ryogakucho';
const CHANNEL_ID  = 'UC67Wr_9pA4I0glIxDt_Cpyw';
const PROGRESS_FILE = 'data_progress.json';
const OUTPUT_FILE   = 'data.json';
const BATCH_SIZE    = 10;   // 1回に処理する動画数（大きくすると速いがエラーも増える）
const WORKERS       = 5;    // 並列バッチ数

// ─── yt-dlp 確認 ──────────────────────────────────────────────────────────────
function findYtdlp() {
  for (const c of ['yt-dlp', '/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
    try { execSync(`${c} --version`, { stdio: 'ignore' }); return c; } catch(e) {}
  }
  return null;
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────
function fmtIso(seconds) {
  if (!seconds) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `PT${h}H${m}M${sec}S`;
  return m > 0 ? `PT${m}M${sec}S` : `PT${sec}S`;
}
function parseDate(d) {
  if (!d || d === 'NA') return '';
  const s = String(d);
  return s.length === 8 ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z` : '';
}
function saveProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')); } catch(e) {}
  }
  return null;
}

// ─── STEP 1: 全動画IDをフラット取得 ──────────────────────────────────────────
function fetchAllIds(ytdlp) {
  console.log('📹 チャンネルの全動画IDを取得中（1〜2分）...');
  const res = spawnSync(ytdlp, [
    '--flat-playlist', '--dump-json', '--no-warnings', CHANNEL_URL
  ], { encoding: 'utf-8', maxBuffer: 300*1024*1024, timeout: 300000 });

  if (res.error || res.status !== 0) {
    console.error('❌ flat-playlist 失敗:', (res.stderr||'').substring(0,300));
    process.exit(1);
  }

  const videos = [];
  for (const line of res.stdout.trim().split('\n').filter(Boolean)) {
    try {
      const v = JSON.parse(line);
      if (!v.id || !v.title) continue;
      const thumb = (v.thumbnails && v.thumbnails.length > 0)
        ? v.thumbnails[Math.min(2, v.thumbnails.length-1)].url
        : `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`;
      videos.push({
        id:          v.id,
        title:       v.title,
        viewCount:   v.view_count || 0,
        duration:    fmtIso(v.duration),
        thumbnail:   thumb,
        publishedAt: '',
        description: '',
        playlists:   []
      });
    } catch(e) {}
  }
  console.log(`   → ${videos.length} 件\n`);
  return videos;
}

// ─── STEP 2: 1バッチ分のメタデータ取得 ───────────────────────────────────────
function fetchMeta(ytdlp, ids) {
  const urls = ids.map(id => `https://www.youtube.com/watch?v=${id}`);
  const res = spawnSync(ytdlp, [
    '--no-warnings', '--no-download',
    '--print', '%(id)s\t%(upload_date)s\t%(description)s',
    ...urls
  ], { encoding: 'utf-8', maxBuffer: 20*1024*1024, timeout: 120000 });

  const map = {};
  for (const line of (res.stdout||'').split('\n').filter(Boolean)) {
    const [id, upload_date, ...rest] = line.split('\t');
    if (id) map[id] = { publishedAt: parseDate(upload_date), description: rest.join('\t').substring(0,400) };
  }
  return map;
}

// ─── STEP 3: プレイリスト取得 ─────────────────────────────────────────────────
function fetchPlaylists(ytdlp) {
  console.log('📂 プレイリスト一覧を取得中...');
  const res = spawnSync(ytdlp, [
    '--flat-playlist', '--dump-json', '--no-warnings', `${CHANNEL_URL}/playlists`
  ], { encoding: 'utf-8', maxBuffer: 30*1024*1024, timeout: 60000 });

  const playlists = [];
  for (const line of (res.stdout||'').trim().split('\n').filter(Boolean)) {
    try {
      const p = JSON.parse(line);
      if (p.id && p.title) playlists.push({ id: p.id, title: p.title });
    } catch(e) {}
  }
  console.log(`   → ${playlists.length} 件\n`);
  return playlists;
}

function fetchPlaylistMap(ytdlp, playlists) {
  const map = {};
  for (const pl of playlists) {
    process.stdout.write(`   🗂  [${pl.title.substring(0,20)}...]\n`);
    const res = spawnSync(ytdlp, [
      '--flat-playlist', '--print', '%(id)s', '--no-warnings',
      `https://www.youtube.com/playlist?list=${pl.id}`
    ], { encoding: 'utf-8', maxBuffer: 10*1024*1024, timeout: 60000 });
    for (const id of (res.stdout||'').trim().split('\n').filter(Boolean)) {
      if (!map[id]) map[id] = [];
      map[id].push({ id: pl.id, title: pl.title });
    }
  }
  console.log();
  return map;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const isReset = process.argv.includes('--reset');
  if (isReset && fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log('🔄 進捗をリセットしました\n');
  }

  console.log('🚀 リベ大 YouTube データ取得（yt-dlp / APIキー不要）');
  console.log('   ✅ 中断しても再実行で続きから再開できます\n');

  const ytdlp = findYtdlp();
  if (!ytdlp) { console.error('❌ yt-dlp が見つかりません: brew install yt-dlp'); process.exit(1); }

  // 進捗ファイルを読み込む（再開時）
  let progress = loadProgress();
  let videos, playlists, plMap;
  let startBatch = 0;

  if (progress && !isReset) {
    console.log(`♻️  前回の進捗を検出: ${progress.done}/${progress.total} 完了 → 続きから再開\n`);
    videos    = progress.videos;
    playlists = progress.playlists || [];
    plMap     = progress.plMap     || {};
    startBatch = progress.nextBatch || 0;
  } else {
    // 初回: IDリスト・プレイリストを取得
    videos    = fetchAllIds(ytdlp);
    playlists = fetchPlaylists(ytdlp);
    plMap     = playlists.length > 0 ? fetchPlaylistMap(ytdlp, playlists) : {};
    startBatch = 0;

    // プレイリスト情報を付与
    for (const v of videos) v.playlists = plMap[v.id] || [];

    // 初期進捗を保存
    saveProgress({ videos, playlists, plMap, done: 0, total: videos.length, nextBatch: 0 });
  }

  // ─── 日付・説明の取得（未取得分のみ） ──────────────────────────────────────
  const pending = videos.filter(v => !v.publishedAt);
  const total   = videos.length;

  if (pending.length === 0) {
    console.log('✅ すべての動画の日付取得済み。data.json を書き出します。\n');
  } else {
    const already = total - pending.length;
    console.log(`📅 投稿日・説明を取得中...`);
    console.log(`   取得済: ${already} 件 ／ 残り: ${pending.length} 件 ／ 合計: ${total} 件`);
    const estMin = Math.ceil(pending.length / BATCH_SIZE / WORKERS * 3);
    console.log(`   推定残り時間: 約 ${estMin} 分\n`);

    // バッチに分割
    const batches = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      batches.push(pending.slice(i, i + BATCH_SIZE).map(v => v.id));
    }

    const videoMap = Object.fromEntries(videos.map(v => [v.id, v]));
    let doneBatches = startBatch;
    let doneCount   = already;

    // WORKERS 並列でバッチ処理
    let batchIdx = startBatch;
    const processBatch = async () => {
      while (batchIdx < batches.length) {
        const idx   = batchIdx++;
        const batch = batches[idx];
        const meta  = fetchMeta(ytdlp, batch);

        for (const id of batch) {
          if (meta[id]) {
            videoMap[id].publishedAt = meta[id].publishedAt;
            videoMap[id].description = meta[id].description;
          }
          doneCount++;
        }
        doneBatches = idx + 1;

        const pct = Math.round(doneCount / total * 100);
        process.stdout.write(`\r   進捗: ${doneCount}/${total} (${pct}%)  `);

        // 10バッチごとに進捗保存（Ctrl+C 対策）
        if (idx % 10 === 0) {
          saveProgress({ videos, playlists, plMap, done: doneCount, total, nextBatch: doneBatches });
        }
      }
    };

    await Promise.all(Array.from({ length: WORKERS }, processBatch));
    console.log('\n');

    // 最終進捗保存
    saveProgress({ videos, playlists, plMap, done: doneCount, total, nextBatch: batches.length });
  }

  // ─── ソートして data.json に保存 ───────────────────────────────────────────
  videos.sort((a, b) => {
    if (!a.publishedAt && !b.publishedAt) return 0;
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });

  const output = { videos, playlists, channelId: CHANNEL_ID, fetchedAt: new Date().toISOString() };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');

  // 進捗ファイルを削除
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);

  console.log('🎉 完了！');
  console.log(`   動画数:       ${videos.length} 本`);
  console.log(`   プレイリスト: ${playlists.length} 件`);
  console.log(`   ファイルサイズ: ${(fs.statSync(OUTPUT_FILE).size/1024/1024).toFixed(1)} MB`);
  console.log(`\n次のステップ: git add data.json && git commit -m "add video data" && git push`);
}

// Ctrl+C でも進捗を保存してから終了
process.on('SIGINT', () => {
  console.log('\n\n⚠️  中断されました。進捗は data_progress.json に保存済みです。');
  console.log('   再開するには: node fetch-videos.js');
  process.exit(0);
});

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
