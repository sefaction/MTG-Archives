"""Source-bound shared framing. An inferred frame is never a manual boundary."""
import hashlib
import math

POLICY = 'shared-card-frame-v1'


def checked_frame(frame, image, data):
    from photo_input import validate_manual_region
    required = {'version', 'policy', 'photoDigest', 'sourceWidth', 'sourceHeight',
                'region', 'rotationDegrees', 'sourceMethod', 'boundary'}
    if (not isinstance(frame, dict) or set(frame) != required or type(frame['version']) is not int
            or frame['version'] != 1 or frame['policy'] != POLICY
            or type(frame['rotationDegrees']) is not int or frame['rotationDegrees'] not in (0, 180)
            or frame['boundary'] not in ('OBSERVED', 'INFERRED', 'OPERATOR')
            or not isinstance(frame['sourceMethod'], str) or not 1 <= len(frame['sourceMethod']) <= 60
            or type(frame['sourceWidth']) is not int or type(frame['sourceHeight']) is not int
            or (frame['sourceWidth'], frame['sourceHeight']) != (image.shape[1], image.shape[0])
            or frame['photoDigest'] != hashlib.sha256(data).hexdigest()):
        raise ValueError('Prepared frame identity changed')
    validate_manual_region(frame['region'])
    return frame


def prepared_crop(image, frame, data, manual_region=None):
    import cv2
    import numpy as np
    from manual_card_region import _checked_manual_region
    checked_frame(frame, image, data)
    quad = _checked_manual_region(image, frame['region'])
    transform = cv2.getPerspectiveTransform(quad, np.float32([[0,0],[999,0],[999,1396],[0,1396]]))
    crop = cv2.warpPerspective(image, transform, (1000,1397))
    if frame['rotationDegrees'] == 180:
        crop = cv2.rotate(crop, cv2.ROTATE_180)
    geometry = {'status': 'PROPOSED', 'method': frame['sourceMethod'], 'quad': quad.tolist(),
                'sourceFrame': {'width': image.shape[1], 'height': image.shape[0]},
                'preparedFrame': frame, 'boundaryVerified': False}
    if manual_region is not None:
        geometry['manualRegion'] = manual_region
    return crop, geometry


def prepared_source(image, frame, data):
    from manual_card_region import manual_card_source
    checked_frame(frame, image, data)
    # Keep native pixel resolution for registration/visibility guards. Rotation
    # and projective registration are recovered by the existing SIFT matcher.
    return manual_card_source(image, frame['region'])
