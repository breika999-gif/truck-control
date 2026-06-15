import { useCallback, useEffect, useState } from 'react';
import Mapbox from '@rnmapbox/maps';

const OFFLINE_STYLE_URL = 'mapbox://styles/mapbox/navigation-day-v1';
const MIN_ZOOM = 5;
const MAX_ZOOM = 14;

export interface OfflinePack {
  name: string;
  regionName: string;
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  completedTiles: number;
  requiredTiles: number;
  completedBytes: number;
  state: 'inactive' | 'active' | 'complete' | 'unknown';
  percentage: number;
}

type PackMetadata = {
  regionName?: string;
  bounds?: [number, number, number, number];
  minZoom?: number;
  maxZoom?: number;
};

type PackStatus = {
  percentage: number;
  completedTileCount: number;
  requiredResourceCount: number;
  completedResourceSize: number;
};

function packState(status: PackStatus): OfflinePack['state'] {
  if (status.percentage >= 100) return 'complete';
  if (status.percentage > 0) return 'active';
  return 'inactive';
}

function packFromStatus(name: string, metadata: PackMetadata, status: PackStatus): OfflinePack {
  return {
    name,
    regionName: metadata.regionName ?? name,
    bounds: metadata.bounds ?? [0, 0, 0, 0],
    minZoom: metadata.minZoom ?? MIN_ZOOM,
    maxZoom: metadata.maxZoom ?? MAX_ZOOM,
    completedTiles: status.completedTileCount ?? 0,
    requiredTiles: status.requiredResourceCount ?? 0,
    completedBytes: status.completedResourceSize ?? 0,
    state: packState(status),
    percentage: Math.max(0, Math.min(100, Number.isFinite(status.percentage) ? status.percentage : 0)),
  };
}

export function useOfflineMaps(): {
  packs: OfflinePack[];
  downloading: boolean;
  downloadRegion: (name: string, bounds: [number, number, number, number]) => Promise<void>;
  deleteRegion: (name: string) => Promise<void>;
  refreshPacks: () => Promise<void>;
} {
  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [downloading, setDownloading] = useState(false);

  const refreshPacks = useCallback(async () => {
    const stored = await Mapbox.offlineManager.getPacks();
    const next = await Promise.all(stored.map(async pack => {
      const status = await pack.status() as PackStatus;
      return packFromStatus(pack.name, pack.metadata as PackMetadata, status);
    }));
    setPacks(next);
    setDownloading(next.some(pack => pack.state === 'active'));
  }, []);

  const downloadRegion = useCallback(async (
    name: string,
    bounds: [number, number, number, number],
  ) => {
    const [west, south, east, north] = bounds;
    setDownloading(true);
    await Mapbox.offlineManager.createPack({
      name,
      styleURL: OFFLINE_STYLE_URL,
      bounds: [[east, north], [west, south]],
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      metadata: { regionName: name, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM },
    }, (_pack, status) => {
      const updated = packFromStatus(name, { regionName: name, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }, status);
      setPacks(current => [...current.filter(pack => pack.name !== name), updated]);
      setDownloading(updated.state === 'active');
    }, (_pack, error) => {
      console.warn('[OfflineMaps] pack download failed:', error.message);
      setDownloading(false);
    });
    await refreshPacks();
  }, [refreshPacks]);

  const deleteRegion = useCallback(async (name: string) => {
    Mapbox.offlineManager.unsubscribe(name);
    await Mapbox.offlineManager.deletePack(name);
    await refreshPacks();
  }, [refreshPacks]);

  useEffect(() => {
    refreshPacks().catch(error => console.warn('[OfflineMaps] refresh failed:', error));
  }, [refreshPacks]);

  return { packs, downloading, downloadRegion, deleteRegion, refreshPacks };
}
