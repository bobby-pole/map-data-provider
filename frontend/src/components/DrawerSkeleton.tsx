export function DrawerSkeleton({
  title = "Loading…",
  lines = 4,
}: {
  title?: string;
  lines?: number;
}) {
  return (
    <div className="drawerSection drawerSkeleton" aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="sectionHeading skeletonHeader">
        <h2>{title}</h2>
      </div>
      <div className="skeletonBody">
        <div className="skeletonLine short" />
        <div className="skeletonCard" />
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className="skeletonRow">
            <div className="skeletonBox" />
            <div className="skeletonText" />
          </div>
        ))}
      </div>
    </div>
  );
}
