// G21.40 (issue #621) - escape-encoded probe fixtures.
// Machine files carry NO raw CJK bytes: gitguard (\p{Han}, U+3000-303F) stays
// enabled; the probe renders real glyphs at runtime from these escapes.
// Polish Latin-Ext letters are kept literal: no commit guard flags them.
window.PROBE_FIXTURES = {
  "meta": {
    "generator": "G21.40 (issue #621) escape-encoded fixtures; machine files carry no raw CJK bytes",
    "candidates": [
      "zh-Hans",
      "zh-Hant"
    ]
  },
  "langPicker": {
    "existingChips": [
      "Belarusian",
      "English",
      "\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430",
      "Deutsch",
      "Espa\u00f1ol",
      "Fran\u00e7ais",
      "\u010ce\u0161tina"
    ],
    "candidateHans": {
      "label": "\u4e2d\u6587\uff08\u7b80\u4f53\uff09",
      "note": "candidate, not activated"
    },
    "candidateHant": {
      "label": "\u4e2d\u6587\uff08\u7e41\u9ad4\uff09",
      "note": "candidate, not activated"
    },
    "screenTitle": "\u8bed\u8a00 / \u8a9e\u8a00",
    "screenTitleRu": "\u041c\u043e\u0432\u0430"
  },
  "guideCard": {
    "nameHans": "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u4e0e\u9ec4\u91d1\u5df7\u5bfc\u89c8",
    "nameHant": "\u5e03\u62c9\u683c\u57ce\u5821\u6b77\u53f2\u5efa\u7bc9\u7fa4\u8207\u9ec3\u91d1\u5df7\u5c0e\u89bd",
    "nameLongNoSpaces": "\u5e03\u62c9\u683c\u57ce\u5821\u5386\u53f2\u5efa\u7b51\u7fa4\u7b2c\u4e8c\u5ead\u9662\u4e0e\u9ec4\u91d1\u5df7\u8054\u7968\u552e\u7968\u5904\u5165\u53e3",
    "namePolish": "\u017belazowa Wola \u2014 \u0141\u00f3d\u017a \u0105\u0118\u0119 \u00d3\u00f3\u0144\u015b\u0107",
    "durationHans": "\u65f6\u957f 2\u5c0f\u65f630\u5206\u949f",
    "durationHant": "\u6642\u9577 2\u5c0f\u664230\u5206\u9418",
    "priceHans": "\u00a5152/\u4eba \u00b7 \u542b\u8bed\u97f3\u5bfc\u89c8",
    "priceHant": "\u00a5152/\u4eba \u00b7 \u542b\u8a9e\u97f3\u5c0e\u89bd",
    "distanceMixed": "\u8ddd\u8001\u57ce\u5e7f\u573a 2.0\u516c\u91cc\uff0c\u7ea625\u5206\u949f",
    "dateMixed": "1873\u5e7410\u67086\u65e5\uff0c\u5f00\u653e\u81f318:00"
  },
  "actions": {
    "primaryHans": "\u5f00\u59cb\u6e38\u89c8",
    "primaryHant": "\u958b\u59cb\u904a\u89bd",
    "secondaryHans": "\u4e0b\u8f7d\u79bb\u7ebf\u5305",
    "secondaryHant": "\u4e0b\u8f09\u96e2\u7dda\u5305",
    "disabledHans": "\u6682\u4e0d\u5f00\u653e",
    "disabledHant": "\u66ab\u4e0d\u958b\u653e"
  },
  "errorState": {
    "hans": "\u9519\u8bef\uff1a\u5185\u5bb9\u4e0d\u53ef\u79bb\u7ebf\u4f7f\u7528\u3002\u8bf7\u8fde\u63a5\u7f51\u7edc\u540e\u91cd\u8bd5\uff08\u4ee3\u7801 E-1042\uff09\u3002",
    "hant": "\u932f\u8aa4\uff1a\u5167\u5bb9\u4e0d\u53ef\u96e2\u7dda\u4f7f\u7528\u3002\u8acb\u9023\u63a5\u7db2\u8def\u5f8c\u91cd\u8a66\uff08\u4ee3\u78bc E-1042\uff09\u3002",
    "unavailableHans": "\u6b64\u7ad9\u70b9\u6682\u65e0\u4e2d\u6587\u8bd1\u6587",
    "unavailableHant": "\u6b64\u7ad9\u9ede\u66ab\u7121\u4e2d\u6587\u8b6f\u6587"
  },
  "narrative": {
    "hans": "\u57ce\u5821\u5efa\u4e8e\u516c\u5143880\u5e74\u524d\u540e\uff0c\u662f\u6b27\u6d32\u6700\u5927\u7684\u53e4\u5efa\u7b51\u7fa4\u4e4b\u4e00\u3002\u300c\u9ec4\u91d1\u5df7\u300d\u7684\u5c0f\u5c4b\u572816\u4e16\u7eaa\u4f4f\u8fc7\u91d1\u5320\uff0c1916\u5e74\u51ac\uff0c\u4f5c\u5bb6\u5361\u592b\u5361\u66fe\u5728\u8fd9\u91cc\u77ed\u6682\u5c45\u4f4f\u3002\u5168\u6bb5\u8bb2\u89e3\u7ea612\u5206\u949f\uff0c\u53ef\u5728\u79bb\u7ebf\u6a21\u5f0f\u6536\u542c\u3002",
    "hant": "\u57ce\u5821\u5efa\u65bc\u897f\u5143880\u5e74\u524d\u5f8c\uff0c\u662f\u6b50\u6d32\u6700\u5927\u7684\u53e4\u5efa\u7bc9\u7fa4\u4e4b\u4e00\u3002\u300c\u9ec3\u91d1\u5df7\u300d\u7684\u5c0f\u5c4b\u572816\u4e16\u7d00\u4f4f\u904e\u91d1\u5320\uff0c1916\u5e74\u51ac\uff0c\u4f5c\u5bb6\u5361\u592b\u5361\u66fe\u5728\u9019\u88e1\u77ed\u66ab\u5c45\u4f4f\u3002\u5168\u6bb5\u8b1b\u89e3\u7d0412\u5206\u9418\uff0c\u53ef\u5728\u96e2\u7dda\u6a21\u5f0f\u6536\u807d\u3002"
  },
  "timer": {
    "clock": "12:34",
    "hans": "\u7b2c2\u7ad9 \u00b7 02\u520605\u79d2",
    "hant": "\u7b2c2\u7ad9 \u00b7 02\u520605\u79d2",
    "remainingHans": "\u5269\u4f59 11\u520626\u79d2",
    "remainingHant": "\u5269\u9918 11\u520626\u79d2"
  },
  "audioLabel": {
    "hans": "\u666e\u901a\u8bdd\uff08\u7b80\u4f53\uff09\u00b7 \u8bed\u97f3\u5bfc\u89c8 \u00b7 \u79bb\u7ebf\u53ef\u7528",
    "hant": "\u570b\u8a9e\uff08\u7e41\u9ad4\uff09\u00b7 \u8a9e\u97f3\u5c0e\u89bd \u00b7 \u96e2\u7dda\u53ef\u7528",
    "mixedHans": "\u5df2\u6682\u505c \u00b7 12/24 \u7ad9\u70b9"
  },
  "stress": {
    "puaGlyph": "\ue0ff",
    "rareIdeograph": "\ud869\udeb6",
    "mixedRun": "\u8ba2\u5355\u91cc\u7a0b11.6km \u00b7 \u5168\u90e8340\u6761 \u00b7 \u00a5152/\u4eba\uff5e18:00",
    "u00B7": "\u00b7"
  }
};
