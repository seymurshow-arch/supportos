type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

export default function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-sb-green">
        <span className="h-1.5 w-1.5 rounded-full bg-sb-green" />
        {eyebrow}
      </div>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
      {description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-[#8ea0b8]">{description}</p> : null}
    </div>
  );
}
