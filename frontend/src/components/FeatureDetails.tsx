import { Fragment } from "react";

import { featureInspection, type SelectedProviderFeature } from "../inspection";

export function FeatureDetails({ selected }: { selected: SelectedProviderFeature | null }) {
  if (!selected) {
    return <section className="inspectorSection"><h2>Selected feature</h2><p className="muted">Click a visible map feature to inspect its provider evidence.</p></section>;
  }
  const inspection = featureInspection(selected);
  return (
    <section className="inspectorSection featureDetails">
      <h2>Selected feature</h2>
      <h3>{inspection.title}</h3>
      <dl>
        <dt>source</dt><dd>{inspection.source}</dd>
        <dt>attribution</dt><dd>{inspection.attribution}</dd>
        <dt>confidence</dt><dd>{inspection.confidence}</dd>
        <dt>readiness</dt><dd>{inspection.readiness}</dd>
      </dl>
      <h4>Limitations</h4>
      <ul>{inspection.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      <h4>Provider attributes</h4>
      <dl className="attributeList">{inspection.providerAttributes.map((attribute) => <Fragment key={attribute.name}><dt>{attribute.name}</dt><dd>{attribute.value}</dd></Fragment>)}</dl>
    </section>
  );
}
