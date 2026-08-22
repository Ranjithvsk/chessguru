// Two-blob animated background. Painterly warmth without competing with content.
export default function Aurora() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      <div className="absolute -top-20 -left-20 w-[600px] h-[600px] rounded-full opacity-40 blob-a"
           style={{ background: "radial-gradient(circle, #a855f7 0%, transparent 65%)" }} />
      <div className="absolute top-40 -right-40 w-[700px] h-[700px] rounded-full opacity-30 blob-b"
           style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 65%)" }} />
    </div>
  );
}
