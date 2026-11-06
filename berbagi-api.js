'use strict';

const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const router = express.Router();
const uploadDirectory = path.join(__dirname, 'uploads');
fsSync.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename(request, file, callback) {
      const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
      callback(null, `${crypto.randomUUID()}${extensions[file.mimetype]}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter(request, file, callback) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      const error = new Error('Bukti transfer harus berupa JPG, PNG, atau WebP.');
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  }
});

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseConfigured = Boolean(supabaseUrl && serviceRoleKey);

async function supabaseRequest(table, query = {}, options = {}) {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: 'application/json'
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.prefer) headers.Prefer = options.prefer;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const content = await response.text();
  let data = null;
  if (content) {
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error(`Supabase returned an invalid response (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    throw new Error(data?.message || `Supabase request failed (HTTP ${response.status}).`);
  }
  return data;
}

router.use('/api/admin', express.json({ limit: '32kb' }));

function requireSupabase(request, response, next) {
  if (!supabaseConfigured) {
    response.status(503).json({
      error: 'API QAF Berbagi belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di file .env.'
    });
    return;
  }
  next();
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return firstBuffer.length === secondBuffer.length && crypto.timingSafeEqual(firstBuffer, secondBuffer);
}

function requireAdmin(request, response, next) {
  const configuredKey = process.env.ADMIN_KEY;
  if (!configuredKey) {
    response.status(503).json({ error: 'Panel bendahara belum dikonfigurasi. Isi ADMIN_KEY di file .env.' });
    return;
  }

  const submittedKey = request.get('x-admin-key') || request.query.key || '';
  if (!safeEqual(submittedKey, configuredKey)) {
    response.status(401).json({ error: 'Admin key salah.' });
    return;
  }
  next();
}

async function getCampaignStatsMap() {
  const donations = await supabaseRequest('donations', {
    select: 'campaign_id, amount',
    status: 'eq.verified'
  });

  const stats = new Map();
  for (const donation of donations || []) {
    const campaignId = Number(donation.campaign_id);
    const current = stats.get(campaignId) || { collected: 0, donors: 0 };
    current.collected += Number(donation.amount || 0);
    current.donors += 1;
    stats.set(campaignId, current);
  }
  return stats;
}

async function getCampaigns() {
  const campaigns = await supabaseRequest('campaigns', {
    select: '*',
    active: 'eq.true',
    order: 'id.desc'
  });

  const stats = await getCampaignStatsMap();
  return campaigns.map((campaign) => ({
    ...campaign,
    ...(stats.get(Number(campaign.id)) || { collected: 0, donors: 0 })
  }));
}

function reportError(response, error) {
  console.error('QAF Berbagi API error:', error);
  if (!response.headersSent) response.status(500).json({ error: 'Terjadi kesalahan saat menghubungi layanan QAF Berbagi.' });
}

router.get('/api/config', (request, response) => {
  response.json({
    bank: process.env.BANK_INFO || '',
    donationEnabled: supabaseConfigured
  });
});

router.get('/api/campaigns', requireSupabase, async (request, response) => {
  try {
    response.json(await getCampaigns());
  } catch (error) {
    reportError(response, error);
  }
});

router.get('/api/campaigns/:slug', requireSupabase, async (request, response) => {
  try {
    const campaigns = await supabaseRequest('campaigns', {
      select: '*',
      slug: `eq.${request.params.slug}`,
      active: 'eq.true',
      limit: '1'
    });
    const campaign = campaigns[0];
    if (!campaign) {
      response.status(404).json({ error: 'Kampanye tidak ditemukan.' });
      return;
    }

    const donations = await supabaseRequest('donations', {
      select: 'name, anonymous, amount, message, created_at',
      campaign_id: `eq.${campaign.id}`,
      status: 'eq.verified',
      order: 'created_at.desc'
    });

    const verifiedDonations = donations;
    response.json({
      ...campaign,
      collected: verifiedDonations.reduce((sum, donation) => sum + Number(donation.amount || 0), 0),
      donors: verifiedDonations.length,
      recent: verifiedDonations.slice(0, 10).map((donation) => ({
        ...donation,
        name: donation.anonymous ? 'Hamba Allah' : donation.name
      }))
    });
  } catch (error) {
    reportError(response, error);
  }
});

router.post('/api/campaigns/:slug/donations', requireSupabase, (request, response, next) => {
  upload.single('proof')(request, response, (error) => {
    if (error) {
      response.status(error.status || (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400))
        .json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Ukuran bukti transfer maksimal 2 MB.' : error.message });
      return;
    }
    next();
  });
}, async (request, response) => {
  let uploadedFile;
  let donationSaved = false;
  try {
    uploadedFile = request.file;
    const campaigns = await supabaseRequest('campaigns', {
      select: 'id',
      slug: `eq.${request.params.slug}`,
      active: 'eq.true',
      limit: '1'
    });
    const campaign = campaigns[0];
    if (!campaign) {
      response.status(404).json({ error: 'Kampanye tidak ditemukan.' });
      return;
    }

    const amount = Number.parseInt(request.body.amount, 10);
    const name = typeof request.body.name === 'string' ? request.body.name.trim().slice(0, 80) : '';
    if (!Number.isSafeInteger(amount) || amount < 10000 || !name || !uploadedFile) {
      response.status(400).json({
        error: 'Nama, nominal minimal Rp10.000, dan bukti transfer (JPG/PNG/WebP, maks 2 MB) wajib diisi.'
      });
      return;
    }
    await supabaseRequest('donations', {}, {
      method: 'POST',
      prefer: 'return=minimal',
      body: [{
        campaign_id: campaign.id,
        name,
        anonymous: request.body.anonymous === 'on' || request.body.anonymous === 'true',
        amount,
        message: typeof request.body.message === 'string' ? request.body.message.slice(0, 300) : '',
        proof: uploadedFile.filename,
        status: 'pending'
      }]
    });

    donationSaved = true;
    response.json({ ok: true });
  } catch (error) {
    reportError(response, error);
  } finally {
    if (uploadedFile && !donationSaved) {
      try {
        await fs.unlink(uploadedFile.path);
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('QAF Berbagi upload cleanup error:', error);
      }
    }
  }
});

router.get('/api/admin/donations', requireAdmin, requireSupabase, async (request, response) => {
  try {
    const data = await supabaseRequest('donations', {
      select: '*, campaigns(title)',
      order: 'id.desc'
    });
    response.json(data.map((donation) => ({
      ...donation,
      title: donation.campaigns?.title || ''
    })));
  } catch (error) {
    reportError(response, error);
  }
});

router.patch('/api/admin/donations/:id', requireAdmin, requireSupabase, async (request, response) => {
  try {
    if (!['verified', 'rejected'].includes(request.body.status)) {
      response.status(400).json({ error: 'Status donasi tidak valid.' });
      return;
    }
    await supabaseRequest('donations', { id: `eq.${request.params.id}` }, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { status: request.body.status }
    });
    response.json({ ok: true });
  } catch (error) {
    reportError(response, error);
  }
});

router.post('/api/admin/campaigns', requireAdmin, requireSupabase, async (request, response) => {
  const body = request.body;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const target = Number.parseInt(body.target, 10);
  if (!title || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      !Number.isSafeInteger(target) || target <= 0) {
    response.status(400).json({ error: 'Judul, slug, dan target kampanye harus valid.' });
    return;
  }

  try {
    await supabaseRequest('campaigns', {}, {
      method: 'POST',
      prefer: 'return=minimal',
      body: [{
        slug,
        title,
        category: typeof body.category === 'string' ? body.category.slice(0, 80) : '',
        summary: typeof body.summary === 'string' ? body.summary.slice(0, 300) : '',
        description: typeof body.description === 'string' ? body.description.slice(0, 5000) : '',
        target,
        deadline: typeof body.deadline === 'string' && body.deadline ? body.deadline : null,
        active: true
      }]
    });
    response.json({ ok: true });
  } catch (error) {
    console.error('QAF Berbagi campaign create error:', error);
    response.status(400).json({ error: 'Gagal menyimpan kampanye (slug mungkin sudah ada).' });
  }
});

router.get('/api/admin/proof/:file', requireAdmin, (request, response) => {
  const filename = path.basename(request.params.file);
  if (filename !== request.params.file) {
    response.sendStatus(404);
    return;
  }
  response.sendFile(path.join(uploadDirectory, filename), (error) => {
    if (error && !response.headersSent) response.sendStatus(error.statusCode || 404);
  });
});

router.use((error, request, response, next) => {
  console.error('QAF Berbagi API request error:', error);
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(error.status || 500).json({
    error: error.status ? error.message : 'Terjadi kesalahan saat menghubungi layanan QAF Berbagi.'
  });
});

module.exports = router;
