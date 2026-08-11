/**
 * Web 端 PPT 制作工作台
 *
 * 流程：选主题 → 选模板 → 填内容 → 一键生成下载
 * 风格与 ChatContainer / SkillsPanel 保持一致，使用 Tailwind + shadcn 风格。
 */
import { useEffect, useState } from 'react';
import {
  fetchPptThemes,
  fetchPptTemplates,
  downloadPpt,
  type ThemeMeta,
  type TemplateMeta,
  type SlideSpec,
  type PptSpec,
} from '@/api/ppt';
import { Sparkles, Download, Plus, Trash2, Loader2 } from 'lucide-react';

const DEFAULT_COVER: SlideSpec = {
  template: 'cover',
  title: '我的菜谱',
  subtitle: '精选 3 道家常菜',
  data: {},
};

export function PptStudio() {
  const [themes, setThemes] = useState<ThemeMeta[]>([]);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [themeId, setThemeId] = useState('warm-kitchen');
  const [filename, setFilename] = useState('recipes');
  const [slides, setSlides] = useState<SlideSpec[]>([DEFAULT_COVER]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, tpl] = await Promise.all([fetchPptThemes(), fetchPptTemplates()]);
        if (cancelled) return;
        setThemes(t.themes);
        setTemplates(tpl.templates);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSlide = (idx: number, patch: Partial<SlideSpec>) => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const updateSlideData = (idx: number, key: string, value: unknown) => {
    setSlides((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        return { ...s, data: { ...(s.data ?? {}), [key]: value } };
      }),
    );
  };

  const addSlide = (template: SlideSpec['template']) => {
    setSlides((prev) => [
      ...prev,
      {
        template,
        title: '新页面',
        data: {},
      },
    ]);
  };

  const removeSlide = (idx: number) => {
    setSlides((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const spec: PptSpec = { theme: themeId, filename, slides };
      await downloadPpt(spec, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-6 gap-4 overflow-y-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
          <Sparkles className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">PPT 工作台</h1>
          <p className="text-sm text-muted-foreground">主题 + 模板 + 内容，一键生成 PPTX</p>
        </div>
      </div>

      {/* 主题与文件名 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">主题</span>
          <select
            value={themeId}
            onChange={(e) => setThemeId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">文件名</span>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="presentation"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">添加新页面</span>
          <div className="flex gap-2">
            <select
              onChange={(e) => {
                if (e.target.value) {
                  addSlide(e.target.value as SlideSpec['template']);
                  e.target.value = '';
                }
              }}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">+ 选择模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.type}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* 幻灯片编辑 */}
      <div className="flex-1 flex flex-col gap-3">
        {slides.map((slide, idx) => (
          <SlideEditor
            key={idx}
            idx={idx}
            slide={slide}
            templates={templates}
            onChange={(patch) => updateSlide(idx, patch)}
            onDataChange={(key, value) => updateSlideData(idx, key, value)}
            onRemove={() => removeSlide(idx)}
          />
        ))}
      </div>

      {/* 生成按钮 */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleGenerate}
          disabled={loading || slides.length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {loading ? '生成中...' : '生成 PPT 并下载'}
        </button>
      </div>
    </div>
  );
}

interface SlideEditorProps {
  idx: number;
  slide: SlideSpec;
  templates: TemplateMeta[];
  onChange: (patch: Partial<SlideSpec>) => void;
  onDataChange: (key: string, value: unknown) => void;
  onRemove: () => void;
}

function SlideEditor({ idx, slide, templates, onChange, onDataChange, onRemove }: SlideEditorProps) {
  const matchedTemplate = templates.find((t) => t.type === slide.template);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
          <span className="text-sm font-medium">{matchedTemplate?.name || slide.template}</span>
        </div>
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-red-500 transition-colors"
          aria-label="删除页面"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">标题</span>
          <input
            value={slide.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">副标题（可选）</span>
          <input
            value={slide.subtitle || ''}
            onChange={(e) => onChange({ subtitle: e.target.value })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {/* 内容页附加字段 */}
      {slide.template === 'content' && (
        <ContentDataEditor data={slide.data ?? {}} onChange={onDataChange} />
      )}
      {slide.template === 'toc' && (
        <TocDataEditor data={slide.data ?? {}} onChange={onDataChange} />
      )}
    </div>
  );
}

function ContentDataEditor({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const ingredients = Array.isArray(data.ingredients) ? (data.ingredients as string[]) : [];
  const steps = Array.isArray(data.steps) ? (data.steps as string[]) : [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
      <StringListEditor
        label="食材"
        values={ingredients}
        onChange={(v) => onChange('ingredients', v)}
      />
      <StringListEditor
        label="步骤"
        values={steps}
        onChange={(v) => onChange('steps', v)}
      />
    </div>
  );
}

function TocDataEditor({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const items = Array.isArray(data.items)
    ? (data.items as Array<{ num: string; title: string }>)
    : [{ num: '01', title: '' }];
  const updateItem = (idx: number, patch: Partial<{ num: string; title: string }>) => {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange('items', next);
  };
  const addItem = () => {
    const nextNum = String(items.length + 1).padStart(2, '0');
    onChange('items', [...items, { num: nextNum, title: '' }]);
  };
  const removeItem = (idx: number) => {
    onChange(
      'items',
      items.filter((_, i) => i !== idx),
    );
  };
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">目录条目</span>
        <button onClick={addItem} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />
          添加
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={it.num}
              onChange={(e) => updateItem(i, { num: e.target.value })}
              className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm font-mono"
            />
            <input
              value={it.title}
              onChange={(e) => updateItem(i, { title: e.target.value })}
              placeholder="标题"
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <button onClick={() => removeItem(i)} className="text-muted-foreground hover:text-red-500">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const update = (idx: number, value: string) => {
    onChange(values.map((v, i) => (i === idx ? value : v)));
  };
  const add = () => onChange([...values, '']);
  const remove = (idx: number) => onChange(values.filter((_, i) => i !== idx));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <button onClick={add} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />
          添加
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={v}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <button onClick={() => remove(i)} className="text-muted-foreground hover:text-red-500">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
