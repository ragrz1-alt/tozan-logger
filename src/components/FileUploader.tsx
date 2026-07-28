import React, { useCallback, useState } from 'react';
import { UploadCloud, Mountain, Compass } from 'lucide-react';
import type { CourseId } from '../utils/logParser';

interface FileUploaderProps {
  onFilesParsed: (contents: { name: string; content: string }[], course: CourseId) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ onFilesParsed }) => {
  const [draggingCourse, setDraggingCourse] = useState<CourseId | null>(null);

  const handleDrag = useCallback((e: React.DragEvent, course: CourseId) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDraggingCourse(course);
    } else if (e.type === 'dragleave') {
      setDraggingCourse(null);
    }
  }, []);

  const getAllFiles = async (dataTransferItemList: DataTransferItemList): Promise<File[]> => {
    const files: File[] = [];
    
    const readEntry = async (entry: any) => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve) => entry.file(resolve));
        files.push(file);
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const entries = await new Promise<any[]>((resolve) => {
          dirReader.readEntries(resolve);
        });
        for (const childEntry of entries) {
          await readEntry(childEntry);
        }
      }
    };

    const promises = [];
    for (let i = 0; i < dataTransferItemList.length; i++) {
      const item = dataTransferItemList[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          promises.push(readEntry(entry));
        }
      }
    }
    
    await Promise.all(promises);
    return files;
  };

  const handleDrop = useCallback(async (e: React.DragEvent, course: CourseId) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingCourse(null);

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const files = await getAllFiles(e.dataTransfer.items);
      processFiles(files, course);
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files), course);
    }
  }, [onFilesParsed]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, course: CourseId) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files), course);
    }
  };

  const processFiles = (files: File[], course: CourseId) => {
    const logFiles = files.filter(file => file.name.toLowerCase().endsWith('.log') || file.name.toLowerCase().endsWith('.txt'));
    if (logFiles.length === 0) {
      alert('.log または .LOG (.txt) ファイルを選択してください');
      return;
    }

    const readPromises = logFiles.map(file => {
      return new Promise<{ name: string; content: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          if (e.target?.result) {
            resolve({ name: file.name, content: e.target.result as string });
          } else {
            reject(new Error('Failed to read file'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
    });

    Promise.all(readPromises).then(results => {
      onFilesParsed(results, course);
    }).catch(err => {
      console.error(err);
      alert('ファイルの読み込みに失敗しました');
    });
  };

  return (
    <div style={{ margin: '1rem 0 2.5rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
          利尻山 2大コース専用 カウンターログ読み込み
        </h2>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', maxWidth: '640px', margin: '0 auto', lineHeight: 1.6 }}>
          カウンターリセットによりファイル名が <code style={{ backgroundColor: 'var(--bg-secondary)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>0000.LOG</code> 等になる場合でも、
          該当するコースのエリアにドロップすることでセンサー方向ルールとともに正しく仕分けて登録されます。
        </p>
      </div>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
        gap: '1.75rem' 
      }}>
        {/* 鴛泊コース用アップローダー */}
        <div className="card" style={{ 
          borderTop: '4px solid #10b981', 
          display: 'flex', 
          flexDirection: 'column',
          position: 'relative',
          boxShadow: draggingCourse === 'oshidomari' ? '0 0 0 3px rgba(16, 185, 129, 0.4)' : undefined,
          transition: 'all 0.2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Mountain size={22} style={{ color: '#10b981' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>鴛泊（おしどまり）コース</h3>
            </div>
            <span style={{ 
              fontSize: '0.75rem', 
              fontWeight: 700, 
              padding: '0.2rem 0.6rem', 
              borderRadius: '999px', 
              backgroundColor: 'rgba(16, 185, 129, 0.15)', 
              color: '#10b981' 
            }}>
              メイン北麓ルート
            </span>
          </div>

          <div style={{ 
            fontSize: '0.85rem', 
            color: 'var(--text-secondary)', 
            marginBottom: '1rem',
            padding: '0.6rem 0.8rem',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '6px',
            borderLeft: '3px solid #10b981'
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              📍 進行方向 左側設置（自動判定）
            </div>
            <div>
              <strong>R が入山</strong> (山頂方向) / <strong>L が下山</strong> (登山口方向)
            </div>
          </div>

          <div 
            className={`dropzone ${draggingCourse === 'oshidomari' ? 'active' : ''}`}
            onDragEnter={(e) => handleDrag(e, 'oshidomari')}
            onDragLeave={(e) => handleDrag(e, 'oshidomari')}
            onDragOver={(e) => handleDrag(e, 'oshidomari')}
            onDrop={(e) => handleDrop(e, 'oshidomari')}
            onClick={() => document.getElementById('fileUploadOshidomari')?.click()}
            style={{ 
              flex: 1, 
              borderColor: draggingCourse === 'oshidomari' ? '#10b981' : undefined,
              backgroundColor: draggingCourse === 'oshidomari' ? 'rgba(16, 185, 129, 0.05)' : undefined 
            }}
          >
            <UploadCloud className="dropzone-icon" style={{ color: '#10b981' }} />
            <div className="dropzone-text" style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              鴛泊用 0000.LOG をドロップ
            </div>
            <div className="dropzone-subtext">クリックしてファイルまたはフォルダを選択</div>
            <input 
              id="fileUploadOshidomari" 
              type="file" 
              multiple 
              {...{ webkitdirectory: "" }}
              accept=".log,.LOG,.txt,.TXT" 
              style={{ display: 'none' }} 
              onChange={(e) => handleFileInput(e, 'oshidomari')}
            />
          </div>
        </div>

        {/* 沓形コース用アップローダー */}
        <div className="card" style={{ 
          borderTop: '4px solid #3b82f6', 
          display: 'flex', 
          flexDirection: 'column',
          position: 'relative',
          boxShadow: draggingCourse === 'kutsugata' ? '0 0 0 3px rgba(59, 130, 246, 0.4)' : undefined,
          transition: 'all 0.2s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Compass size={22} style={{ color: '#3b82f6' }} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>沓形（くつがた）コース</h3>
            </div>
            <span style={{ 
              fontSize: '0.75rem', 
              fontWeight: 700, 
              padding: '0.2rem 0.6rem', 
              borderRadius: '999px', 
              backgroundColor: 'rgba(59, 130, 246, 0.15)', 
              color: '#3b82f6' 
            }}>
              西麓 見返台ルート
            </span>
          </div>

          <div style={{ 
            fontSize: '0.85rem', 
            color: 'var(--text-secondary)', 
            marginBottom: '1rem',
            padding: '0.6rem 0.8rem',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '6px',
            borderLeft: '3px solid #3b82f6'
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              📍 進行方向 右側設置（自動判定）
            </div>
            <div>
              <strong>L が入山</strong> (山頂方向) / <strong>R が下山</strong> (登山口方向)
            </div>
          </div>

          <div 
            className={`dropzone ${draggingCourse === 'kutsugata' ? 'active' : ''}`}
            onDragEnter={(e) => handleDrag(e, 'kutsugata')}
            onDragLeave={(e) => handleDrag(e, 'kutsugata')}
            onDragOver={(e) => handleDrag(e, 'kutsugata')}
            onDrop={(e) => handleDrop(e, 'kutsugata')}
            onClick={() => document.getElementById('fileUploadKutsugata')?.click()}
            style={{ 
              flex: 1, 
              borderColor: draggingCourse === 'kutsugata' ? '#3b82f6' : undefined,
              backgroundColor: draggingCourse === 'kutsugata' ? 'rgba(59, 130, 246, 0.05)' : undefined 
            }}
          >
            <UploadCloud className="dropzone-icon" style={{ color: '#3b82f6' }} />
            <div className="dropzone-text" style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              沓形用 0000.LOG をドロップ
            </div>
            <div className="dropzone-subtext">クリックしてファイルまたはフォルダを選択</div>
            <input 
              id="fileUploadKutsugata" 
              type="file" 
              multiple 
              {...{ webkitdirectory: "" }}
              accept=".log,.LOG,.txt,.TXT" 
              style={{ display: 'none' }} 
              onChange={(e) => handleFileInput(e, 'kutsugata')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
