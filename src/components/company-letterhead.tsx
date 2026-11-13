/**
 * The company logo block at the top of printed documents (progress report,
 * quotation). The logo image already carries the company name.
 */
export function CompanyLetterhead() {
  return (
    <div className="flex flex-col gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/villamor-logo.png"
        alt="Villamor Construction and Dev't. Corporation"
        width={1768}
        height={390}
        className="h-14 w-auto max-w-full sm:h-16"
      />
      <div className="text-xs text-ink-500">374 Malapit, San Isidro, Nueva Ecija · PCAB Registered</div>
    </div>
  );
}
