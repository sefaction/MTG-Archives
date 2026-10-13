// Preserve every pre-existing observation/proposal when the extra comparison
// cannot fit the established 64KiB job envelope. Omission never means agreement.
export function boundedPrintingDetailOutput<T extends Record<string, unknown>>(output: T): T {
  if(Buffer.byteLength(JSON.stringify(output)) <= 65536) return output;
  const native = output.printingNative as {candidates:Record<string,unknown>[]};
  const summary = output.printing as {candidates:Record<string,unknown>[]};
  const stripped = {...output,
    printingNative:{...native,candidates:native.candidates.map(({details,referenceImage,setSymbol,...candidate})=>candidate)},
    printing:{...summary,detailStatus:"OUTPUT_BUDGET",candidates:summary.candidates.map(
      ({details,referenceImage,referenceFace,setSymbol,...candidate})=>candidate)},
  } as T;
  if(Buffer.byteLength(JSON.stringify(stripped)) > 65536){
    // An already-full legacy result retains its original failure semantics.
    const {detailStatus,...withoutMarker} = stripped.printing as Record<string,unknown>;
    return {...stripped,printing:withoutMarker};
  }
  return stripped;
}
