/**
 * fetch-videos.js — YouTube Data API v3 使用
 * 使い方: node fetch-videos.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');

const API_KEY    = process.env.YOUTUBE_API_KEY;
const OUTPUT     = 'data.json';

if (!API_KEY) {
  console.error('❌ YOUTUBE_API_KEY が未設定です（.env を確認）');
  process.exit(1);
}

const yt = google.youtube({ version: 'v3', auth: API_KEY });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtIso(iso) { return iso || ''; }

// ─── チャンネル情報取得（ハンドル → channel ID & uploads playlist ID）────────
async function getChannelInfo() {
  console.log('📡 チャンネル情報を取得中...');
  const res = await yt.channels.list({
    part: 'snippet,contentDetails',
    forHandle: 'ryogakucho'
  });
  const ch = res.data.items?.[0];
  if (!ch) throw new Error('チャンネルが見つかりません');
  const channelId   = ch.id;
  const uploadsId   = ch.contentDetails.relatedPlaylists.uploads;
  console.log(`   チャンネル: ${ch.snippet.title}`);
  console.log(`   ID: ${channelId}`);
  console.log(`   アップロードPL: ${uploadsId}\n`);
  return { channelId, uploadsId, title: ch.snippet.title };
}

// ─── プレイリスト一覧取得 ──────────────────────────────────────────────────────
async function getPlaylists(channelId) {
  console.log('📂 プレイリスト一覧を取得中...');
  const playlists = [];
  let pageToken;
  do {
    const res = await yt.playlists.list({
      part: 'snippet,contentDetails',
      channelId, maxResults: 50, pageToken
    });
    for (const p of res.data.items || []) {
      playlists.push({ id: p.id, title: p.snippet.title, videoCount: p.contentDetails.itemCount });
    }
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(100);
  } while (pageToken);
  console.log(`   → ${playlists.length} 件\n`);
  return playlists;
}

// ─── プレイリスト内の動画ID一覧 ───────────────────────────────────────────────
async function getPlaylistVideoIds(playlistId) {
  const ids = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: 'contentDetails',
      playlistId, maxResults: 50, pageToken
    });
    for (const item of res.data.items || []) {
      const vid = item.contentDetails.videoId;
      if (vid) ids.push(vid);
    }
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(100);
  } while (pageToken);
  return ids;
}

// ─── 全アップロード動画のスニペット取得 ───────────────────────────────────────
async function getAllUploadedVideos(uploadsId) {
  console.log('📹 全動画リストを取得中...');
  const items = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: 'snippet,contentDetails',
      playlistId: uploadsId, maxResults: 50, pageToken
    });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(100);
    process.stdout.write(`\r   取得中: ${items.length} 件...`);
  } while (pageToken);
  console.log(`\n   → ${items.length} 件\n`);
  return items;
}

// ─── 動画の統計・詳細を50件ずつバッチ取得 ─────────────────────────────────────
async function getVideoDetails(videoIds) {
  console.log('📊 統計情報を取得中...');
  const map = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await yt.videos.list({
      part: 'statistics,contentDetails',
      id: batch.join(',')
    });
    for (const v of res.data.items || []) {
      map[v.id] = {
        viewCount:    parseInt(v.statistics.viewCount    || 0),
        likeCount:    parseInt(v.statistics.likeCount    || 0),
        commentCount: parseInt(v.statistics.commentCount || 0),
        duration:     v.contentDetails.duration || ''
      };
    }
    if (i + 50 < videoIds.length) await sleep(100);
    process.stdout.write(`\r   統計取得: ${Math.min(i + 50, videoIds.length)}/${videoIds.length}`);
  }
  console.log('\n');
  return map;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 リベ大 YouTube データ取得（API v3）\n');

  // 1. チャンネル情報
  const { channelId, uploadsId } = await getChannelInfo();

  // 2. プレイリスト取得
  const playlists = await getPlaylists(channelId);

  // 3. プレイリスト × 動画IDマップ構築
  console.log('🗂  各プレイリストの動画IDを取得中...');
  const plMap = {};
  for (const pl of playlists) {
    process.stdout.write(`   [${pl.title.substring(0, 25)}]\n`);
    const ids = await getPlaylistVideoIds(pl.id);
    for (const id of ids) {
      if (!plMap[id]) plMap[id] = [];
      plMap[id].push({ id: pl.id, title: pl.title });
    }
    await sleep(150);
  }
  console.log();

  // 4. 全アップロード動画取得
  const uploadItems = await getAllUploadedVideos(uploadsId);
  const validItems  = uploadItems.filter(
    i => i.snippet.title !== 'Deleted video' && i.snippet.title !== 'Private video'
  );

  // 5. 統計情報バッチ取得
  const videoIds = validItems.map(i => i.contentDetails.videoId);
  const details  = await getVideoDetails(videoIds);

  // 6. データ組み立て
  const videos = validItems.map(item => {
    const vid   = item.contentDetails.videoId;
    const d     = details[vid] || {};
    const thumb = item.snippet.thumbnails?.medium?.url
                || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
    return {
      id:           vid,
      title:        item.snippet.title,
      description:  (item.snippet.description || '').substring(0, 400),
      publishedAt:  item.contentDetails.videoPublishedAt || item.snippet.publishedAt || '',
      thumbnail:    thumb,
      viewCount:    d.viewCount    || 0,
      likeCount:    d.likeCount    || 0,
      commentCount: d.commentCount || 0,
      duration:     d.duration     || '',
      playlists:    plMap[vid]     || []
    };
  });

  // 新しい順にソート
  videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const output = {
    videos, playlists, channelId,
    fetchedAt: new Date().toISOString()
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  const mb = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);

  console.log('🎉 完了！');
  console.log(`   動画数:       ${videos.length} 本`);
  console.log(`   プレイリスト: ${playlists.length} 件`);
  console.log(`   ファイルサイズ: ${mb} MB`);
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
