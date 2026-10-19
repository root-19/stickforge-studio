/** Public pages (landing, login, register) scroll on their own, without the app sidebar. */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return <div className="scrollbar-thin h-full overflow-y-auto">{children}</div>;
}
