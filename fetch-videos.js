/**
 * fetch-videos.js
 * YouTube Data API v3 を使ってリベ大チャンネルの全動画を取得し data.json に保存する
 *
 * 使い方:
 *   1. .env に YOUTUBE_API_KEY=<あなたのAPIキー> を設定
 *   2. npm install
 *   3. node fetch-videos.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');

const API_KEY    = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = 'UCD9BLCu6zRxJgj_MjCfqfEA';

if (!API_KEY) {
  console.error('❌ YOUTUBE_API_KEY が設定されていません。.env ファイルを確認してください。');
  process.exit(1);
}

const youtube = google.youtube({ version: 'v3', auth: API_KEY });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** プレイリストの全アイテムをページネーションで取得 */
async function getAllPlaylistItems(playlistId) {
  const items = [];
  let pageToken;
  do {
    const res = await youtube.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: 50,
      pageToken
    });
    items.push(...res.data.items);
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(150);
  } while (pageToken);
  return items;
}

/** チャンネルの全プレイリストを取得 */
async function getChannelPlaylists(channelId) {
  const playlists = [];
  let pageToken;
  do {
    const res = await youtube.playlists.list({
      part: 'snippet,contentDetails',
      channelId,
      maxResults: 50,
      pageToken
    });
    playlists.push(...res.data.items);
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(150);
  } while (pageToken);
  return playlists;
}

/** 動画の統計情報・詳細を 50 件ずつバッチ取得 */
async function getVideoDetails(videoIds) {
  const map = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await youtube.videos.list({
      part: 'statistics,contentDetails',
      id: batch.join(',')
    });
    for (const item of res.data.items) {
      map[item.id] = {
        viewCount:    parseInt(item.statistics.viewCount    || 0),
        likeCount:    parseInt(item.statistics.likeCount    || 0),
        commentCount: parseInt(item.statistics.commentCount || 0),
        duration:     item.contentDetails.duration || ''
      };
    }
    if (i + 50 < videoIds.length) await sleep(200);
    console.log(`  統計取得: ${Math.min(i+50, videoIds.length)} / ${videoIds.length}`);
  }
  return map;
}

async function main() {
  console.log('🚀 リベ大 YouTube データ取得を開始します...\n');

  // ── プレイリスト取得 ──────────────────────────────────────────────────────
  console.log('📂 チャンネルのプレイリストを取得中...');
  const playlists = await getChannelPlaylists(CHANNEL_ID);
  console.log(`   → ${playlists.length} 件のプレイリストを取得\n`);

  // videoId → プレイリスト[] マップを構築
  console.log('🗂  各プレイリストの動画リストを取得中...');
  const videoPlaylistMap = {};
  for (const pl of playlists) {
    console.log(`   [${pl.snippet.title}]`);
    const items = await getAllPlaylistItems(pl.id);
    for (const item of items) {
      const vid = item.contentDetails.videoId;
      if (!videoPlaylistMap[vid]) videoPlaylistMap[vid] = [];
      videoPlaylistMap[vid].push({ id: pl.id, title: pl.snippet.title });
    }
    await sleep(200);
  }
  console.log();

  // ── アップロード一覧取得 ───────────────────────────────────────────────────
  // チャンネル ID の先頭 "UC" → "UU" でアップロードプレイリスト ID になる
  const uploadsId = 'UU' + CHANNEL_ID.slice(2);
  console.log('📹 アップロード動画を取得中...');
  const uploadItems = await getAllPlaylistItems(uploadsId);
  console.log(`   → ${uploadItems.length} 本の動画を取得\n`);

  // ── 統計情報取得 ──────────────────────────────────────────────────────────
  const validItems = uploadItems.filter(item =>
    item.snippet.title !== 'Deleted video' && item.snippet.title !== 'Private video'
  );
  const videoIds = validItems.map(item => item.contentDetails.videoId);

  console.log('📊 動画の統計・詳細情報を取得中...');
  const details = await getVideoDetails(videoIds);
  console.log();

  // ── データ組み立て ─────────────────────────────────────────────────────────
  const videos = validItems.map(item => {
    const vid    = item.contentDetails.videoId;
    const d      = details[vid] || {};
    const thumb  = item.snippet.thumbnails?.medium?.url
                || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
    return {
      id:           vid,
      title:        item.snippet.title,
      description:  (item.snippet.description || '').substring(0, 400),
      publishedAt:  item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
      thumbnail:    thumb,
      viewCount:    d.viewCount    || 0,
      likeCount:    d.likeCount    || 0,
      commentCount: d.commentCount || 0,
      duration:     d.duration     || '',
      playlists:    videoPlaylistMap[vid] || []
    };
  });

  // 新しい順にソート
  videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const output = {
    videos,
    playlists: playlists.map(p => ({
      id:         p.id,
      title:      p.snippet.title,
      videoCount: p.contentDetails.itemCount || 0
    })),
    fetchedAt: new Date().toISOString()
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2), 'utf-8');

  console.log(`✅ 完了！`);
  console.log(`   動画数:       ${videos.length} 本`);
  console.log(`   プレイリスト: ${playlists.length} 件`);
  console.log(`   保存先:       data.json`);
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err.message);
  process.exit(1);
});
