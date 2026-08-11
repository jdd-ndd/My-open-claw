import React, { useRef } from 'react';
import { Upload } from 'lucide-react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * 文件上传组件
 * [占位] 完整拖拽上传、进度监控、大文件分片等功能尚未实现
 */
export const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, disabled = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
        title="上传文件"
      >
        <Upload className="w-4 h-4" />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
};
