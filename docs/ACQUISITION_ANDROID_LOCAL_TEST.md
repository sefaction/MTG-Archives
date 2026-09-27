# Android local scan test

Status: connection choice and actual device acceptance are pending. The desktop
browser fixture uses a fake camera and original Android image files; it cannot
certify the phone's camera, permissions, orientation or background behavior.

## Option A: USB for the first test

1. Keep the laptop awake with the local Docker app running.
2. On Android, enable Developer options and USB debugging. Connect a data-capable
   USB cable and accept the debugging prompt for this laptop.
3. In desktop Chrome, open `chrome://inspect/#devices`; enable device discovery.
4. Open Port forwarding. Map device port `13001` to `127.0.0.1:13001` on the laptop,
   and enable forwarding.
5. In Android Chrome, visit `http://localhost:13001/imports/scan`, sign in to the
   local snapshot and open the camera. Grant camera permission when prompted.
6. After testing, turn off the port forward and USB debugging if no longer needed.

This follows [Chrome's device setup](https://developer.chrome.com/docs/devtools/remote-debugging/)
and [local server forwarding](https://developer.chrome.com/docs/devtools/remote-debugging/local-server).
Loopback origins can be trustworthy contexts under the
[Secure Contexts specification](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy).
The actual phone must still confirm camera availability; an ordinary LAN HTTP
address is not the same as this loopback route.

## Option B: local Wi-Fi HTTPS

Prepare only after the user chooses it: a local reverse proxy with a certificate
trusted by Android, scoped to the laptop's local address. Do not expose the app
through a public tunnel or change Unraid. Certificate installation and the actual
phone's trust/camera check require the user at the device. No proxy or certificate
installation is claimed by this document.

## First hands-on task

Choose a test location/section, confirm its remaining-space count, and photograph
three separate cards. Watch the batch counter and background recognition; review
printings and per-card attributes. Stop capture, select one card, preview placement,
and add it to Inventory. Verify one copy was added and the other cards remain in
the batch. Reload and check that the committed card cannot be added or retaken.
Try photo-library upload too. Report camera permission/rear-camera selection,
orientation, readability and any confusing step. These are local test copies.
