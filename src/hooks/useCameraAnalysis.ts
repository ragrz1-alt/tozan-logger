import { useState, useEffect } from 'react';

export interface ImageAnalysis {
  fileName: string;
  is_sunny: boolean;
  cloud_cover: number;
  visibility: 'clear' | 'cloudy' | 'foggy' | 'missing';
  reason: string;
  status?: string;
}

export const useCameraAnalysis = () => {
  const [analysisResults, setAnalysisResults] = useState<Record<string, ImageAnalysis[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const cached = localStorage.getItem('tozan_weather_analysis_cache');
    const localData = cached ? JSON.parse(cached) : {};

    fetch('/cams/analysis_results.json')
      .then(res => res.json())
      .then(data => {
        setAnalysisResults({ ...localData, ...data });
        setIsLoading(false);
      })
      .catch(err => {
        console.warn('サーバー側のカメラ解析結果が見つかりません。ローカルキャッシュのみ使用します。', err);
        setAnalysisResults(localData);
        setIsLoading(false);
      });
  }, []);

  return { analysisResults, isLoading };
};
