CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  summary TEXT,
  description TEXT,
  target INTEGER NOT NULL CHECK (target > 0),
  deadline TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donations (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  amount INTEGER NOT NULL CHECK (amount >= 10000),
  message TEXT,
  proof TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.campaigns
  ALTER COLUMN active SET DEFAULT TRUE;
UPDATE public.campaigns SET active = TRUE WHERE active IS NULL;
ALTER TABLE public.campaigns
  ALTER COLUMN active SET NOT NULL;

ALTER TABLE public.donations
  ALTER COLUMN anonymous SET DEFAULT FALSE;
UPDATE public.donations SET anonymous = FALSE WHERE anonymous IS NULL;
ALTER TABLE public.donations
  ALTER COLUMN anonymous SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.campaigns'::regclass
      AND conname = 'campaigns_target_check'
  ) THEN
    ALTER TABLE public.campaigns
      ADD CONSTRAINT campaigns_target_check CHECK (target > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.donations'::regclass
      AND conname = 'donations_amount_check'
  ) THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_amount_check CHECK (amount >= 10000);
  END IF;
END
$$;

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'campaigns'
      AND policyname = 'Public can read active campaigns'
  ) THEN
    CREATE POLICY "Public can read active campaigns"
      ON public.campaigns
      FOR SELECT
      TO anon, authenticated
      USING (active = TRUE);
  END IF;
END
$$;

INSERT INTO campaigns (slug, title, category, summary, description, target)
VALUES
  ('gmmk-masjid-kampus', 'Memakmurkan Masjid Kampus (GMMK)', 'Aksi nyata', 'Subuh berjamaah, logistik Jumat, dan kajian interaktif.', 'Gerakan Memakmurkan Masjid Kampus mengajak subuh berjamaah, menyiapkan kebutuhan Jumatan, dan menghidupkan kajian di masjid kampus.', 5000000),
  ('pbha-tahsin-gratis', 'Kelas Tahsin Gratis (PBHA)', 'Aksi nyata', 'Bimbingan membaca Al-Qur’an gratis untuk mahasiswa dan warga sekitar.', 'Pemberantasan Buta Huruf Al-Qur’an membuka bimbingan membaca Al-Qur’an intensif dan gratis bagi mahasiswa dan masyarakat sekitar kampus.', 3000000),
  ('qaf-peduli', 'QAF Peduli', 'Sosial', 'Program sosial QAF untuk membantu sesama.', 'Dana untuk program sosial QAF Peduli. Rincian penyaluran dipublikasikan setelah kegiatan.', 2000000)
ON CONFLICT (slug) DO NOTHING;
