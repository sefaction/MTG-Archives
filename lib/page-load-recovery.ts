type RecoveryLocation = Pick<Location,"href"|"replace">;
type RecoveryHistory = Pick<History,"state"|"replaceState">;

/** A new GET cannot repeat a failed document POST. Remove even an empty
 * fragment without navigating first, preventing a fragment-only replacement. */
export function navigatePageRecovery(location:RecoveryLocation,history:RecoveryHistory) {
  const target=new URL(location.href);
  const hadFragment=location.href.includes("#");
  target.hash="";
  if(hadFragment)history.replaceState(history.state,"",target.href);
  location.replace(target.href);
}