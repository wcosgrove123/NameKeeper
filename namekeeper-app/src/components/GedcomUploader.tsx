'use client';

import { useCallback, useState } from 'react';

interface GedcomUploaderProps {
  onFileLoaded: (content: string, filename: string) => void;
}

export default function GedcomUploader({ onFileLoaded }: GedcomUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      setIsLoading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        onFileLoaded(content, file.name);
        setIsLoading(false);
      };
      reader.onerror = () => setIsLoading(false);
      reader.readAsText(file);
    },
    [onFileLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.ged') || file.name.endsWith('.gedcom'))) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      className={`
        flex flex-col items-center justify-center p-6 sm:p-12 border-2 border-dashed rounded-xl
        transition-colors cursor-pointer
        ${isDragging ? 'border-amber-500 bg-amber-50' : 'border-slate-300 bg-white hover:border-slate-400'}
      `}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => document.getElementById('gedcom-input')?.click()}
    >
      <input
        id="gedcom-input"
        type="file"
        accept=".ged,.gedcom"
        className="hidden"
        onChange={handleChange}
      />

      {isLoading ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-600">Parsing GEDCOM file...</p>
        </div>
      ) : (
        <>
          <div className="text-4xl mb-4">&#x1F4DC;</div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            Upload Your GEDCOM File
          </h3>
          <p className="text-sm text-slate-500 text-center max-w-md">
            Drag and drop a .ged file here, or click to browse.
            The Name Keeper algorithm will automatically detect all surnames
            and trace patrilineal succession.
          </p>
        </>
      )}
    </div>
  );
}
