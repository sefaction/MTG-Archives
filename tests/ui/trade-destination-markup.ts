import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TradeDestinationSelect } from "../../components/TradeDestinationSelect";

const locations = Array.from({ length: Number(process.argv[2]) }, (_, index) => ({
  id: `location-${index}`,
  path: `Storage ${index}`,
}));
process.stdout.write(renderToStaticMarkup(React.createElement(TradeDestinationSelect, {
  incomingLineCount: 1,
  locations,
})));
