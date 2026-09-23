/**
 * 各頁 AI 功能開關（GET /api/v1/ai/features）。
 * - 依「系統參數 → AI 參數」的開關計算哪些 AI 功能要顯示；
 * - 全站共用同一份快取（首頁載入後即生效，切換頁面不重複打 API）；
 * - 載入中／失敗時 features 為 null，呼叫方應以「顯示（fail-open）」處理，避免空白頁。
 * 見 docs/AI_利用方案.md §4.x。
 */
import { useEffect, useState } from 'react';
import { api, authStore, AiFeatures } from './api/client';

let cache: Promise<AiFeatures> | null = null;

export function getAiFeatures(): Promise<AiFeatures> {
  if (!cache) {
    cache = api.aiFeatures(authStore.getToken() || '').catch((e) => {
      cache = null;
      throw e;
    });
  }
  return cache;
}

/** 配置變更後（如管理員於參數頁切換開關）清除快取，下次讀取重新拉取 */
export function invalidateAiFeatures(): void {
  cache = null;
}

export function useAiFeatures() {
  const [features, setFeatures] = useState<AiFeatures | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getAiFeatures()
      .then((f) => alive && setFeatures(f))
      .catch((e) => alive && setError(e?.message || '載入 AI 功能開關失敗'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const reload = () => {
    invalidateAiFeatures();
    setLoading(true);
    getAiFeatures()
      .then((f) => setFeatures(f))
      .catch((e) => setError(e?.message || '載入 AI 功能開關失敗'))
      .finally(() => setLoading(false));
  };

  return { features, loading, error, reload };
}

/**
 * 便利判斷：開關尚未載入（null）時回傳 true（fail-open，避免空白頁）；
 * 已載入則回傳該功能實際開關值。
 */
export function featureOn(features: AiFeatures | null, key: keyof AiFeatures['features']): boolean {
  return features ? features.features[key] : true;
}
