const SAMPLE = `Quantity,Name,Set Code,Collector Number,Foil,Condition,Location,Notes,Scryfall ID
1,Aven Surveyor,CMR,57,nonfoil,NM,Box-0001,,
2,Ambush Viper,CMR,213,false,NM,Box-0001,,
1,Angel of the Dawn,CMR,6,foil,NM,Binder-0003,,
1,Example Etched Card,ABC,123,etched,LP,Trade Binder,,
1,Blank Foil Example,ABC,124,,NM,Unassigned,,
`;

export async function GET() {
  return new Response(SAMPLE, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        'attachment; filename="sample-inventory-import.csv"',
    },
  });
}
