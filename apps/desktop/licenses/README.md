# Bundled license fallbacks

`../scripts/bundle-notices.ts` uses package-supplied LICENSE, COPYING, COPYRIGHT
and NOTICE files first. These are version-specific fallbacks for packages not
shipping a standalone notice. Recheck sources at every version change.

| Package                  | Notice source                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earendil pi/chord 1.4.0  | [Upstream monorepo license at v1.4.0](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/LICENSE)                                                                                                                                                                 |
| boolbase 1.0.0           | [Upstream ISC text added for the original package](https://github.com/fb55/boolbase/blob/be0bcd8a4e917a0a5895e95b523fbbed05a64871/LICENSE)                                                                                                                                                        |
| data-uri-to-buffer 4.0.1 | Installed package README, which contains the author's complete MIT text                                                                                                                                                                                                                           |
| standardwebhooks 1.1.1   | [Upstream libraries license](https://github.com/standard-webhooks/standard-webhooks/blob/b4d2c14fc5b4ccff3ff271e3b087dff812254c59/libraries/LICENSE)                                                                                                                                              |
| lazy-val 1.0.5           | [Upstream package manifest](https://github.com/develar/lazy-val/blob/b69ad4119f1b19bdab13c61ee2fcc88d46b89071/package.json) names Vladimir Krivosheev and declares MIT but provides no standalone notice; attribution and SPDX MIT text included. Confirm upstream attribution at release review. |
