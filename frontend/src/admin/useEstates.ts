/**
 * 後台屋苑選項：動態從 GET /api/v1/estates 讀取（不再寫死於前端常數）。
 * 模組級快取避免每頁重複請求；屋苑新增/修改/停用後呼叫 invalidateEstates() 使下次重新載入。
 * - activeOptions：僅啟用中屋苑（下拉用）
 * - all / nameOf：全量（含已停用），供歷史資料名稱對照
 */
import { useEffect, useState } from 'react';
import { api, authStore, EstateItem } from '../api/client';

let cache: EstateItem[] | null = null;
let inflight: Promise<EstateItem[]> | null = null;

function load(): Promise<EstateItem[]> {
  const token = authStore.getToken();
  if (!token) return Promise.resolve(cache || []);
  if (!cache && !inflight) {
    inflight = api
      .listEstates(token)
      .then((d) => {
        cache = d.items;
        return d.items;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight || Promise.resolve(cache || []);
}

/** 使快取失效（屋苑管理頁儲存後呼叫，令其他頁面下次進入時重新載入） */
export function invalidateEstates(): void {
  cache = null;
  inflight = null;
}

export interface EstateOptions {
  /** 啟用中屋苑（下拉用） */
  activeOptions: EstateItem[];
  /** 全量屋苑（含已停用，名稱對照用） */
  all: EstateItem[];
  /** 屋苑代碼 → 中文名；查無回傳原碼；'ALL' 回傳「全屋苑」 */
  nameOf: (code?: string | null) => string;
}

export function useEstates(): EstateOptions {
  const [all, setAll] = useState<EstateItem[]>(cache || []);

  useEffect(() => {
    let alive = true;
    load()
      .then((list) => {
        if (alive) setAll(list);
      })
      .catch(() => {
        /* 保持既有值；後端未就緒時不阻斷頁面 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const activeOptions = all.filter((e) => e.isActive === 1);
  const nameOf = (code?: string | null): string => {
    if (!code) return '';
    if (code === 'ALL') return '全屋苑';
    const hit = all.find((e) => e.estateCode === code);
    return hit ? hit.estateNameZh : code;
  };
  return { activeOptions, all, nameOf };
}
