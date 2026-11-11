export interface Migration {
  id: number
  name: string
  sql: string
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: '0001_app_meta',
    sql: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      INSERT INTO app_meta (key, value)
      VALUES ('created_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(key) DO NOTHING;
    `,
  },
  {
    id: 2,
    name: '0002_llm_gateway',
    sql: `
      CREATE TABLE IF NOT EXISTS llm_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS llm_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES llm_providers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_llm_models_provider_id ON llm_models(provider_id);
      CREATE INDEX IF NOT EXISTS idx_llm_models_is_default ON llm_models(is_default);

      CREATE TABLE IF NOT EXISTS llm_usage (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        provider_id TEXT,
        provider_name TEXT NOT NULL,
        model_row_id TEXT,
        model_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        status TEXT NOT NULL,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at);
    `,
  },
  {
    id: 3,
    name: '0003_tikhub_douyin',
    sql: `
      CREATE TABLE IF NOT EXISTS tikhub_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        endpoint TEXT NOT NULL,
        api_token TEXT NOT NULL DEFAULT '',
        timeout_seconds INTEGER NOT NULL DEFAULT 30,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      INSERT INTO tikhub_settings (id, endpoint, api_token, timeout_seconds, enabled, updated_at)
      VALUES (1, 'https://api.tikhub.io', '', 30, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS douyin_accounts (
        id TEXT PRIMARY KEY,
        sec_user_id TEXT NOT NULL UNIQUE,
        uid TEXT,
        unique_id TEXT,
        nickname TEXT NOT NULL,
        avatar_url TEXT,
        signature TEXT,
        follower_count INTEGER NOT NULL DEFAULT 0,
        following_count INTEGER NOT NULL DEFAULT 0,
        aweme_count INTEGER NOT NULL DEFAULT 0,
        total_favorited INTEGER NOT NULL DEFAULT 0,
        profile_url TEXT,
        source_input TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_douyin_accounts_active ON douyin_accounts(is_active);
      CREATE INDEX IF NOT EXISTS idx_douyin_accounts_unique_id ON douyin_accounts(unique_id);
    `,
  },
  {
    id: 4,
    name: '0004_tikhub_usage',
    sql: `
      CREATE TABLE IF NOT EXISTS tikhub_usage (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        path TEXT NOT NULL,
        ok INTEGER NOT NULL,
        status_code INTEGER,
        message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tikhub_usage_created_at ON tikhub_usage(created_at);
      CREATE INDEX IF NOT EXISTS idx_tikhub_usage_path ON tikhub_usage(path);
    `,
  },
  {
    id: 5,
    name: '0005_track_assessments',
    sql: `
      CREATE TABLE IF NOT EXISTS track_assessments (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        status TEXT NOT NULL,
        diagnosis_json TEXT,
        selected_candidate_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_track_assessments_account
        ON track_assessments(account_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_track_assessments_status
        ON track_assessments(status);

      CREATE TABLE IF NOT EXISTS track_candidates (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        heat_score INTEGER NOT NULL DEFAULT 0,
        competition_score INTEGER NOT NULL DEFAULT 0,
        potential_score INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        influencers_json TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(assessment_id) REFERENCES track_assessments(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_track_candidates_assessment
        ON track_candidates(assessment_id, sort_order ASC);

      ALTER TABLE douyin_accounts ADD COLUMN selected_assessment_id TEXT;
      ALTER TABLE douyin_accounts ADD COLUMN selected_track_name TEXT;
      ALTER TABLE douyin_accounts ADD COLUMN selected_candidate_id TEXT;
    `,
  },
  {
    id: 6,
    name: '0006_topics_inbox',
    sql: `
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        assessment_id TEXT,
        candidate_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL DEFAULT '',
        heat_score INTEGER,
        competition_score INTEGER,
        potential_score INTEGER,
        reason TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'track',
        status TEXT NOT NULL DEFAULT 'inbox',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_topics_account_status
        ON topics(account_id, status, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_candidate_unique
        ON topics(candidate_id) WHERE candidate_id IS NOT NULL;
    `,
  },
  {
    id: 7,
    name: '0007_research_videos',
    sql: `
      CREATE TABLE IF NOT EXISTS research_videos (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        aweme_id TEXT,
        title TEXT NOT NULL,
        author_nickname TEXT NOT NULL,
        author_unique_id TEXT,
        cover_url TEXT,
        digg_count INTEGER NOT NULL DEFAULT 0,
        comment_count INTEGER NOT NULL DEFAULT 0,
        share_count INTEGER NOT NULL DEFAULT 0,
        duration_sec INTEGER NOT NULL DEFAULT 0,
        video_type TEXT NOT NULL DEFAULT '其他',
        match_score INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        profile_url TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        editing_style TEXT NOT NULL DEFAULT '',
        breakdown_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_research_videos_topic
        ON research_videos(topic_id, match_score DESC, updated_at DESC);
    `,
  },
  {
    id: 8,
    name: '0008_research_video_play_url',
    sql: `
      ALTER TABLE research_videos ADD COLUMN play_url TEXT;
    `,
  },
  {
    id: 9,
    name: '0009_account_analyses',
    sql: `
      CREATE TABLE IF NOT EXISTS account_analyses (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        diagnosis_json TEXT,
        metrics_json TEXT,
        videos_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'fallback',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_account_analyses_updated
        ON account_analyses(updated_at DESC);
    `,
  },
  {
    id: 10,
    name: '0010_research_local_media_transcript',
    sql: `
      ALTER TABLE research_videos ADD COLUMN local_path TEXT;
      ALTER TABLE research_videos ADD COLUMN media_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE research_videos ADD COLUMN dissect_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE research_videos ADD COLUMN full_transcript TEXT NOT NULL DEFAULT '';
      ALTER TABLE research_videos ADD COLUMN transcript_cues_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE research_videos ADD COLUMN dissect_error TEXT;
    `,
  },
  {
    id: 11,
    name: '0011_studio_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS studio_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'queued',
        message TEXT NOT NULL DEFAULT '',
        percent REAL,
        href TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_studio_jobs_status_created
        ON studio_jobs(status, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_studio_jobs_dedupe
        ON studio_jobs(dedupe_key, status);
    `,
  },
  {
    id: 12,
    name: '0012_research_videos_is_current',
    sql: `
      ALTER TABLE research_videos ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_research_videos_dissect_ready
        ON research_videos(dissect_status, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_research_videos_topic_current
        ON research_videos(topic_id, is_current);
    `,
  },
  {
    id: 13,
    name: '0013_workshop_scripts',
    sql: `
      CREATE TABLE IF NOT EXISTS workshop_scripts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        source_research_video_id TEXT,
        source_aweme_id TEXT,
        source_title TEXT,
        topic_id TEXT,
        topic_title TEXT NOT NULL DEFAULT '',
        video_type TEXT NOT NULL DEFAULT '其他',
        angle TEXT NOT NULL DEFAULT '',
        duration_hint_sec INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        segments_json TEXT NOT NULL DEFAULT '[]',
        hooks_json TEXT NOT NULL DEFAULT '[]',
        cta_options_json TEXT NOT NULL DEFAULT '[]',
        comment_insights_json TEXT NOT NULL DEFAULT '[]',
        full_script_text TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workshop_scripts_updated
        ON workshop_scripts(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workshop_scripts_source
        ON workshop_scripts(source_research_video_id);
    `,
  },
  {
    id: 14,
    name: '0014_research_videos_source',
    sql: `
      ALTER TABLE research_videos ADD COLUMN source TEXT NOT NULL DEFAULT 'sample';
      CREATE INDEX IF NOT EXISTS idx_research_videos_source_updated
        ON research_videos(source, updated_at DESC);
    `,
  },
]
