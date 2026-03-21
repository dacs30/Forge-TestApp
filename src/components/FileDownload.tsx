"use client";

export interface FileDownloadData {
  url: string;
  filename: string;
  description?: string;
}

const FILE_ICONS: Record<string, string> = {
  xlsx: "table",
  xls: "table",
  csv: "table",
  docx: "doc",
  doc: "doc",
  pptx: "slides",
  ppt: "slides",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  svg: "image",
  gif: "image",
  zip: "archive",
  tar: "archive",
  gz: "archive",
};

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[ext] || "file";
}

function FileIconSvg({ type }: { type: string }) {
  const baseClass = "w-8 h-8";

  switch (type) {
    case "table":
      return (
        <div className={`${baseClass} bg-green-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-green-400 text-xs font-bold">XLS</span>
        </div>
      );
    case "doc":
      return (
        <div className={`${baseClass} bg-blue-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-blue-400 text-xs font-bold">DOC</span>
        </div>
      );
    case "slides":
      return (
        <div className={`${baseClass} bg-orange-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-orange-400 text-xs font-bold">PPT</span>
        </div>
      );
    case "pdf":
      return (
        <div className={`${baseClass} bg-red-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-red-400 text-xs font-bold">PDF</span>
        </div>
      );
    case "image":
      return (
        <div className={`${baseClass} bg-purple-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-purple-400 text-xs font-bold">IMG</span>
        </div>
      );
    case "archive":
      return (
        <div className={`${baseClass} bg-yellow-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-yellow-400 text-xs font-bold">ZIP</span>
        </div>
      );
    default:
      return (
        <div className={`${baseClass} bg-zinc-600/20 rounded-lg flex items-center justify-center`}>
          <span className="text-zinc-400 text-xs font-bold">FILE</span>
        </div>
      );
  }
}

export default function FileDownload({ file }: { file: FileDownloadData }) {
  const iconType = getFileIcon(file.filename);

  return (
    <div className="flex justify-start mb-4">
      <a
        href={file.url}
        download={file.filename}
        className="flex items-center gap-3 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-2xl px-4 py-3 transition-colors group max-w-[80%]"
      >
        <FileIconSvg type={iconType} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-100 truncate group-hover:text-white">
            {file.filename}
          </div>
          {file.description && (
            <div className="text-xs text-zinc-500 truncate">
              {file.description}
            </div>
          )}
        </div>
        <div className="shrink-0 text-zinc-500 group-hover:text-zinc-300 transition-colors">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="rotate-0"
          >
            <path
              d="M8 2v8m0 0l3-3m-3 3L5 7M3 13h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </a>
    </div>
  );
}
