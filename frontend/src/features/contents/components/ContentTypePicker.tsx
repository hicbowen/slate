import { TYPE_ITEMS, type AllContentType } from '@/features/contents/model/content-type-meta';

export function ContentTypeCardGrid({
  onChange,
  includeImage,
}: {
  onChange: (t: AllContentType) => void;
  includeImage: boolean;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {TYPE_ITEMS.filter((item) => includeImage || item.type !== 'image').map((it) => (
        <button
          key={it.type}
          type="button"
          onClick={() => onChange(it.type)}
          className="craft-card flex flex-col items-start gap-2 p-4 text-left transition-all hover:bg-cream"
        >
          <it.Icon size={22} />
          <span className="font-serif text-[18px] leading-none">{it.title}</span>
          <span className="font-sans text-[12px] leading-snug text-stone">{it.hint}</span>
        </button>
      ))}
    </div>
  );
}
