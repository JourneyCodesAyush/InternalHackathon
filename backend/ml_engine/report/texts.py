"""Predefined report text in English, Hindi and Marathi.

The report is complete from these templates alone; the language model (optional) only rewrites the
executive summary, risk context and recommendations. Strings use ReportLab paragraph markup
(``NO<sub>2</sub>``). Numbers are always Western digits.
"""

from __future__ import annotations

import pandas as pd

from .analysis import band_key

LANGUAGES = {"en": "English", "hi": "Hindi", "mr": "Marathi"}
NO2 = "NO<sub>2</sub>"
UG = "µg/m³"

MONTHS = {
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"],
    "hi": ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
    "mr": ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर",
           "डिसेंबर"],
}
COMPASS = {
    "en": ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"],
    "hi": ["उत्तर", "उत्तर-पूर्व", "पूर्व", "दक्षिण-पूर्व", "दक्षिण", "दक्षिण-पश्चिम", "पश्चिम", "उत्तर-पश्चिम"],
    "mr": ["उत्तर", "ईशान्य", "पूर्व", "आग्नेय", "दक्षिण", "नैऋत्य", "पश्चिम", "वायव्य"],
}

T = {
    "en": {
        "title": f"Air Quality Report — {NO2}",
        "subtitle": "Satellite-based ground-level nitrogen dioxide assessment",
        "area": "Area", "report_date": "Report date", "window": "Analysis window", "generated": "Generated",
        "status": "Status", "bbox": "Bounding box",
        "h_summary": "Executive Summary",
        "h_comparison": "Comparison with Air Quality Standards",
        "h_map": f"{NO2} Map and Hotspots",
        "h_exposure": "Population Exposure",
        "h_forecast": "Forecast Alerts (next 24 hours)",
        "h_trend": "Weather-Adjusted Trend",
        "h_risk": "Risk and Impact Context",
        "h_reco": "Recommendations and Alerts",
        "h_method": "Data, Method and Limitations",
        "kpi_mean": "Area average", "kpi_vs": "vs 24-h standard", "kpi_area": "Area above standard",
        "kpi_people": "People above standard",
        "metric": "Metric", "current": "Current", "standard": "Standard", "difference": "Difference",
        "row_mean": "Area average (report day)", "row_p95": "95th percentile (250 m cells)",
        "row_max": "Highest 250 m cell", "row_window": "Period average (vs annual standard)",
        "row_share_naaqs": f"Area above 80 {UG}", "row_share_who": f"Area above WHO guideline (25 {UG})",
        "band": "Band", "range": f"Range ({UG})", "share_area": "Share of area", "people": "People",
        "advice": "Health guidance",
        "hotspot": "#", "location": "Location", "value": f"{NO2} ({UG})", "sources": "Likely contributors",
        "horizon": "Time ahead", "fc_mean": f"Area average ({UG})", "fc_max": f"Highest cell ({UG})",
        "fc_share": "Area above standard",
        "above": "above", "below": "below",
        "map_caption": "Ground-level {no2} on {date}, coloured by SRS hazard band; numbers mark the main hotspots. "
                       "Highest cell: {max} {ug} near {near}.",
        "trend_legend": "Blue: observed daily area average · Green: weather-adjusted · Red: 80 {ug} standard",
        "no_population": "Population data is not available for this area.",
        "no_trend": "Too few days in the analysis window to separate weather from emission changes.",
        "narrative_ai": "Narrative sections: AI summary (Gemini). All numbers are computed by the model, not by the AI.",
        "narrative_template": "Narrative sections: standard template. All numbers are computed by the model.",
        "lang_fallback": "Hindi and Marathi reports need a Devanagari font on the server; this report is in English.",
        "h_notice": "Data notice",
        "point_line": "At the selected location, {name}, the model gives {value} {ug} ({band}).",
        "h_point": "Measured Value at the Selected Point",
        "row_point": "NO<sub>2</sub> at the selected point (hourly)",
        "src_upload": "Data source: AI model output from uploaded Sentinel-5P files ({days} days, {first} – {last}), 250 m ground-level map.",
        "src_run": "Data source: AI model output (satellite model run for this area), 250 m ground-level map.",
        "src_google": "Data source: Google Air Quality API, current hourly conditions at {lat}, {lon} ({time}); {raw} {units} converted to µg/m³. No satellite-model map covers this point yet; upload satellite files on the Model Upload page for a 250 m map with hotspots, exposure and trends.",
        "point_summary": "On {date}, NO<sub>2</sub> at {area} was {value} {ug}, {pct}% {dir} the national 24-hour standard of 80 {ug} (status: {status}).",
        "notice_cached": "New satellite data for {requested} could not be processed ({reason}). This report uses the "
                         "model's most recent map for this area, for {used}.",
        "notice_unavailable": "The model could not produce a map for this area on {requested} ({reason}), and no earlier "
                              "map of the area is stored. This document gives the reference standards and health "
                              "guidance; generate the report again later for measured values.",
        "h_standards": "Reference Standards",
        "no_forecast": "The forecast could not be computed for this day.",
        "no_map": "The map image could not be drawn for this day.",
        "page": "Page",
    },
    "hi": {
        "title": f"वायु गुणवत्ता रिपोर्ट — {NO2}",
        "subtitle": "उपग्रह-आधारित ज़मीनी स्तर नाइट्रोजन डाइऑक्साइड आकलन",
        "area": "क्षेत्र", "report_date": "रिपोर्ट की तिथि", "window": "विश्लेषण अवधि", "generated": "तैयार किया गया",
        "status": "स्थिति", "bbox": "सीमा (बाउंडिंग बॉक्स)",
        "h_summary": "कार्यकारी सारांश",
        "h_comparison": "वायु गुणवत्ता मानकों से तुलना",
        "h_map": f"{NO2} मानचित्र और हॉटस्पॉट",
        "h_exposure": "जनसंख्या पर प्रभाव",
        "h_forecast": "पूर्वानुमान चेतावनी (अगले 24 घंटे)",
        "h_trend": "मौसम-समायोजित रुझान",
        "h_risk": "जोखिम और प्रभाव",
        "h_reco": "सिफारिशें और चेतावनियाँ",
        "h_method": "डेटा, पद्धति और सीमाएँ",
        "kpi_mean": "क्षेत्र का औसत", "kpi_vs": "24-घंटे मानक की तुलना में", "kpi_area": "मानक से ऊपर क्षेत्र",
        "kpi_people": "मानक से ऊपर क्षेत्रों में लोग",
        "metric": "मापदंड", "current": "वर्तमान", "standard": "मानक", "difference": "अंतर",
        "row_mean": "क्षेत्र का औसत (रिपोर्ट दिवस)", "row_p95": "95वाँ प्रतिशतक (250 मी. सेल)",
        "row_max": "सर्वाधिक मान (250 मी. सेल)", "row_window": "अवधि का औसत (वार्षिक मानक से तुलना)",
        "row_share_naaqs": f"80 {UG} से ऊपर क्षेत्र", "row_share_who": f"WHO दिशानिर्देश (25 {UG}) से ऊपर क्षेत्र",
        "band": "श्रेणी", "range": f"सीमा ({UG})", "share_area": "क्षेत्र का हिस्सा", "people": "लोग",
        "advice": "स्वास्थ्य सलाह",
        "hotspot": "#", "location": "स्थान", "value": f"{NO2} ({UG})", "sources": "संभावित स्रोत",
        "horizon": "आगामी समय", "fc_mean": f"क्षेत्र औसत ({UG})", "fc_max": f"सर्वाधिक ({UG})",
        "fc_share": "मानक से ऊपर क्षेत्र",
        "above": "अधिक", "below": "कम",
        "map_caption": "{date} को ज़मीनी स्तर {no2}, SRS खतरा श्रेणी के अनुसार रंगों में; अंक मुख्य हॉटस्पॉट दर्शाते हैं। "
                       "सर्वाधिक मान: {max} {ug}, {near} के पास।",
        "trend_legend": "नीला: प्रतिदिन क्षेत्र का मापा गया औसत · हरा: मौसम-समायोजित · लाल: 80 {ug} मानक",
        "no_population": "इस क्षेत्र के लिए जनसंख्या डेटा उपलब्ध नहीं है।",
        "no_trend": "मौसम और उत्सर्जन के प्रभाव को अलग करने के लिए विश्लेषण अवधि में पर्याप्त दिन नहीं हैं।",
        "narrative_ai": "विवरण खंड: AI सारांश (Gemini)। सभी आँकड़े मॉडल द्वारा गणना किए गए हैं, AI द्वारा नहीं।",
        "narrative_template": "विवरण खंड: मानक टेम्पलेट। सभी आँकड़े मॉडल द्वारा गणना किए गए हैं।",
        "h_notice": "डेटा सूचना",
        "point_line": "चयनित स्थान {name} पर मॉडल के अनुसार NO<sub>2</sub> {value} {ug} ({band}) है।",
        "h_point": "चयनित स्थान पर मापा गया मान",
        "row_point": "चयनित स्थान पर NO<sub>2</sub> (प्रति घंटा)",
        "src_upload": "डेटा स्रोत: अपलोड की गई Sentinel-5P फ़ाइलों ({days} दिन, {first} – {last}) पर AI मॉडल का आउटपुट, 250 मी. ज़मीनी स्तर का मानचित्र।",
        "src_run": "डेटा स्रोत: AI मॉडल का आउटपुट (इस क्षेत्र का उपग्रह मॉडल रन), 250 मी. ज़मीनी स्तर का मानचित्र।",
        "src_google": "डेटा स्रोत: Google Air Quality API, {lat}, {lon} पर वर्तमान प्रति घंटा स्थिति ({time}); {raw} {units} को µg/m³ में बदला गया। इस स्थान के लिए अभी उपग्रह-मॉडल मानचित्र उपलब्ध नहीं है; हॉटस्पॉट, जोखिम और रुझान वाले 250 मी. मानचित्र के लिए Model Upload पेज पर उपग्रह फ़ाइलें अपलोड करें।",
        "point_summary": "{date} को {area} में NO<sub>2</sub> {value} {ug} था, जो 80 {ug} के राष्ट्रीय 24-घंटे मानक से {pct}% {dir} है (स्थिति: {status})।",
        "notice_cached": "{requested} का नया उपग्रह डेटा संसाधित नहीं हो सका ({reason})। यह रिपोर्ट इस क्षेत्र के लिए "
                         "मॉडल के सबसे हाल के मानचित्र ({used}) पर आधारित है।",
        "notice_unavailable": "मॉडल {requested} के लिए इस क्षेत्र का मानचित्र नहीं बना सका ({reason}), और इस क्षेत्र का कोई "
                              "पुराना मानचित्र संग्रहीत नहीं है। इस दस्तावेज़ में संदर्भ मानक और स्वास्थ्य मार्गदर्शन दिए गए हैं; "
                              "मापे गए मानों के लिए बाद में रिपोर्ट फिर से बनाएँ।",
        "h_standards": "संदर्भ मानक",
        "no_forecast": "इस दिन के लिए पूर्वानुमान की गणना नहीं हो सकी।",
        "no_map": "इस दिन का मानचित्र चित्र नहीं बन सका।",
        "lang_fallback": "",
        "page": "पृष्ठ",
    },
    "mr": {
        "title": f"हवा गुणवत्ता अहवाल — {NO2}",
        "subtitle": "उपग्रह-आधारित जमिनीलगत नायट्रोजन डायऑक्साइड मूल्यांकन",
        "area": "क्षेत्र", "report_date": "अहवालाची तारीख", "window": "विश्लेषण कालावधी", "generated": "तयार केले",
        "status": "स्थिती", "bbox": "सीमा (बाउंडिंग बॉक्स)",
        "h_summary": "कार्यकारी सारांश",
        "h_comparison": "हवा गुणवत्ता मानकांशी तुलना",
        "h_map": f"{NO2} नकाशा आणि हॉटस्पॉट",
        "h_exposure": "लोकसंख्येवरील परिणाम",
        "h_forecast": "अंदाज इशारे (पुढील 24 तास)",
        "h_trend": "हवामान-समायोजित कल",
        "h_risk": "धोका आणि परिणाम",
        "h_reco": "शिफारसी आणि इशारे",
        "h_method": "माहिती, पद्धत आणि मर्यादा",
        "kpi_mean": "क्षेत्राची सरासरी", "kpi_vs": "24-तास मानकाच्या तुलनेत", "kpi_area": "मानकापेक्षा जास्त क्षेत्र",
        "kpi_people": "मानकापेक्षा जास्त भागांतील लोक",
        "metric": "मापदंड", "current": "सध्याचे", "standard": "मानक", "difference": "फरक",
        "row_mean": "क्षेत्राची सरासरी (अहवाल दिवस)", "row_p95": "95 वे शतमक (250 मी. सेल)",
        "row_max": "सर्वाधिक मूल्य (250 मी. सेल)", "row_window": "कालावधीची सरासरी (वार्षिक मानकाशी तुलना)",
        "row_share_naaqs": f"80 {UG} पेक्षा जास्त क्षेत्र", "row_share_who": f"WHO मार्गदर्शक (25 {UG}) पेक्षा जास्त क्षेत्र",
        "band": "श्रेणी", "range": f"मर्यादा ({UG})", "share_area": "क्षेत्राचा हिस्सा", "people": "लोक",
        "advice": "आरोग्य सल्ला",
        "hotspot": "#", "location": "ठिकाण", "value": f"{NO2} ({UG})", "sources": "संभाव्य स्रोत",
        "horizon": "पुढील कालावधी", "fc_mean": f"क्षेत्र सरासरी ({UG})", "fc_max": f"सर्वाधिक ({UG})",
        "fc_share": "मानकापेक्षा जास्त क्षेत्र",
        "above": "जास्त", "below": "कमी",
        "map_caption": "{date} रोजी जमिनीलगत {no2}, SRS धोका श्रेणीनुसार रंगांत; अंक मुख्य हॉटस्पॉट दर्शवतात. "
                       "सर्वाधिक मूल्य: {max} {ug}, {near} जवळ.",
        "trend_legend": "निळा: दररोजची मोजलेली क्षेत्र सरासरी · हिरवा: हवामान-समायोजित · लाल: 80 {ug} मानक",
        "no_population": "या क्षेत्रासाठी लोकसंख्येची माहिती उपलब्ध नाही.",
        "no_trend": "हवामान आणि उत्सर्जनाचा परिणाम वेगळा करण्यासाठी विश्लेषण कालावधीत पुरेसे दिवस नाहीत.",
        "narrative_ai": "वर्णनात्मक विभाग: AI सारांश (Gemini). सर्व आकडे मॉडेलने मोजले आहेत, AI ने नाहीत.",
        "narrative_template": "वर्णनात्मक विभाग: मानक साचा. सर्व आकडे मॉडेलने मोजले आहेत.",
        "h_notice": "डेटा सूचना",
        "point_line": "निवडलेल्या ठिकाणी, {name} येथे, मॉडेलनुसार NO<sub>2</sub> {value} {ug} ({band}) आहे.",
        "h_point": "निवडलेल्या ठिकाणी मोजलेले मूल्य",
        "row_point": "निवडलेल्या ठिकाणी NO<sub>2</sub> (प्रति तास)",
        "src_upload": "डेटा स्रोत: अपलोड केलेल्या Sentinel-5P फायलींवर ({days} दिवस, {first} – {last}) AI मॉडेलचे आउटपुट, 250 मी. जमिनी पातळीचा नकाशा.",
        "src_run": "डेटा स्रोत: AI मॉडेलचे आउटपुट (या क्षेत्राचा उपग्रह मॉडेल रन), 250 मी. जमिनी पातळीचा नकाशा.",
        "src_google": "डेटा स्रोत: Google Air Quality API, {lat}, {lon} येथील सध्याची प्रति तास स्थिती ({time}); {raw} {units} चे µg/m³ मध्ये रूपांतर केले. या ठिकाणासाठी अद्याप उपग्रह-मॉडेल नकाशा उपलब्ध नाही; हॉटस्पॉट, जोखीम आणि कल असलेल्या 250 मी. नकाशासाठी Model Upload पानावर उपग्रह फायली अपलोड करा.",
        "point_summary": "{date} रोजी {area} येथे NO<sub>2</sub> {value} {ug} होते, जे 80 {ug} या राष्ट्रीय 24-तास मानकापेक्षा {pct}% {dir} आहे (स्थिती: {status}).",
        "notice_cached": "{requested} चा नवीन उपग्रह डेटा प्रक्रिया करता आला नाही ({reason}). हा अहवाल या क्षेत्रासाठी "
                         "मॉडेलच्या सर्वात अलीकडील नकाशावर ({used}) आधारित आहे.",
        "notice_unavailable": "मॉडेल {requested} साठी या क्षेत्राचा नकाशा तयार करू शकले नाही ({reason}), आणि या क्षेत्राचा "
                              "कोणताही जुना नकाशा साठवलेला नाही. या दस्तऐवजात संदर्भ मानके आणि आरोग्य मार्गदर्शन दिले आहे; "
                              "मोजलेल्या मूल्यांसाठी नंतर अहवाल पुन्हा तयार करा.",
        "h_standards": "संदर्भ मानके",
        "no_forecast": "या दिवसासाठी अंदाज मोजता आला नाही.",
        "no_map": "या दिवसाचा नकाशा काढता आला नाही.",
        "lang_fallback": "",
        "page": "पान",
    },
}

STATUS = {
    "en": {"normal": "Normal", "elevated": "Elevated (Warning)", "critical": "Critical", "critical_spike": "Critical Spike"},
    "hi": {"normal": "सामान्य", "elevated": "बढ़ा हुआ (चेतावनी)", "critical": "गंभीर", "critical_spike": "अत्यंत गंभीर उछाल"},
    "mr": {"normal": "सामान्य", "elevated": "वाढलेले (इशारा)", "critical": "गंभीर", "critical_spike": "अतिगंभीर वाढ"},
}
STATUS_DESC = {
    "en": {
        "normal": f"{NO2} across the area is within the national 24-hour standard.",
        "elevated": f"{NO2} is above the Normal band, or exceeds the standard in parts of the area.",
        "critical": f"The area-average {NO2} exceeds the national 24-hour standard of 80 {UG}.",
        "critical_spike": f"The area-average {NO2} is in the Hazardous band (above 180 {UG}).",
    },
    "hi": {
        "normal": f"पूरे क्षेत्र में {NO2} राष्ट्रीय 24-घंटे के मानक के भीतर है।",
        "elevated": f"{NO2} सामान्य श्रेणी से ऊपर है, या क्षेत्र के कुछ हिस्सों में मानक से अधिक है।",
        "critical": f"क्षेत्र का औसत {NO2} राष्ट्रीय 24-घंटे के मानक 80 {UG} से अधिक है।",
        "critical_spike": f"क्षेत्र का औसत {NO2} खतरनाक श्रेणी (180 {UG} से अधिक) में है।",
    },
    "mr": {
        "normal": f"संपूर्ण क्षेत्रात {NO2} राष्ट्रीय 24-तासांच्या मानकाच्या आत आहे.",
        "elevated": f"{NO2} सामान्य श्रेणीपेक्षा जास्त आहे, किंवा क्षेत्राच्या काही भागांत मानकापेक्षा अधिक आहे.",
        "critical": f"क्षेत्राची सरासरी {NO2} राष्ट्रीय 24-तासांच्या 80 {UG} मानकापेक्षा जास्त आहे.",
        "critical_spike": f"क्षेत्राची सरासरी {NO2} धोकादायक श्रेणीत (180 {UG} पेक्षा जास्त) आहे.",
    },
}
BAND = {
    "en": {"normal": "Normal", "moderate": "Moderate", "unhealthy": "Unhealthy", "hazardous": "Hazardous"},
    "hi": {"normal": "सामान्य", "moderate": "मध्यम", "unhealthy": "अस्वास्थ्यकर", "hazardous": "खतरनाक"},
    "mr": {"normal": "सामान्य", "moderate": "मध्यम", "unhealthy": "आरोग्यास अपायकारक", "hazardous": "धोकादायक"},
}
BAND_ADVICE = {  # SRS section 3.3 guidance
    "en": {"normal": "Air quality is satisfactory.", "moderate": "Acceptable; sensitive individuals should take caution.",
           "unhealthy": "Prolonged exposure causes respiratory discomfort.",
           "hazardous": "Trigger industrial and traffic reduction alerts."},
    "hi": {"normal": "वायु गुणवत्ता संतोषजनक है।", "moderate": "स्वीकार्य; संवेदनशील लोगों को सावधानी बरतनी चाहिए।",
           "unhealthy": "लंबे समय तक संपर्क में रहने से साँस लेने में तकलीफ़ होती है।",
           "hazardous": "औद्योगिक और यातायात कटौती की चेतावनी जारी करें।"},
    "mr": {"normal": "हवेची गुणवत्ता समाधानकारक आहे.", "moderate": "स्वीकारार्ह; संवेदनशील व्यक्तींनी काळजी घ्यावी.",
           "unhealthy": "दीर्घकाळ संपर्कामुळे श्वसनास त्रास होतो.",
           "hazardous": "औद्योगिक व वाहतूक कपात इशारे जारी करा."},
}
SOURCE = {
    "en": {"traffic": "major road traffic", "power_plant": "power plant / industrial combustion",
           "dense_urban": "dense urban and commercial activity", "background": "general urban background"},
    "hi": {"traffic": "प्रमुख सड़कों का यातायात", "power_plant": "बिजली संयंत्र / औद्योगिक दहन",
           "dense_urban": "घनी शहरी और व्यावसायिक गतिविधि", "background": "सामान्य शहरी पृष्ठभूमि"},
    "mr": {"traffic": "प्रमुख रस्त्यांवरील वाहतूक", "power_plant": "वीज प्रकल्प / औद्योगिक ज्वलन",
           "dense_urban": "दाट शहरी व व्यावसायिक क्रियाकलाप", "background": "सामान्य शहरी पार्श्वभूमी"},
}

SUMMARY = {
    "en": "On {date}, the average ground-level {no2} across {area} was {mean} {ug}, {pct}% {dir} the national "
          "24-hour standard of 80 {ug} (status: {status}). {share}% of the area exceeded the standard, and the "
          "highest 250 m cell reached {max} {ug} near {near}.",
    "hi": "{date} को {area} में ज़मीनी स्तर पर {no2} का औसत {mean} {ug} रहा, जो राष्ट्रीय 24-घंटे के मानक 80 {ug} से "
          "{pct}% {dir} है (स्थिति: {status})। क्षेत्र का {share}% हिस्सा मानक से ऊपर रहा, और सबसे अधिक मान {max} {ug} "
          "{near} के पास दर्ज हुआ।",
    "mr": "{date} रोजी {area} मध्ये जमिनीलगत {no2} ची सरासरी {mean} {ug} होती, जी राष्ट्रीय 24-तासांच्या 80 {ug} "
          "मानकापेक्षा {pct}% {dir} आहे (स्थिती: {status}). क्षेत्राचा {share}% भाग मानकापेक्षा जास्त होता, आणि सर्वाधिक "
          "मूल्य {max} {ug} {near} जवळ नोंदवले गेले.",
}
POPULATION = {
    "en": {"some": "About {people} people ({share}% of residents) live where {no2} exceeds the standard; the "
                   "population-weighted average is {pw} {ug}.",
           "none": "No residents live in cells above the standard; the population-weighted average is {pw} {ug}."},
    "hi": {"some": "लगभग {people} लोग (निवासियों का {share}%) ऐसे क्षेत्रों में रहते हैं जहाँ {no2} मानक से अधिक है; "
                   "जनसंख्या-भारित औसत {pw} {ug} है।",
           "none": "मानक से अधिक {no2} वाले क्षेत्रों में कोई आबादी नहीं है; जनसंख्या-भारित औसत {pw} {ug} है।"},
    "mr": {"some": "सुमारे {people} लोक (रहिवाशांपैकी {share}%) अशा भागांत राहतात जिथे {no2} मानकापेक्षा जास्त आहे; "
                   "लोकसंख्या-भारित सरासरी {pw} {ug} आहे.",
           "none": "मानकापेक्षा जास्त {no2} असलेल्या भागांत कोणतीही लोकसंख्या नाही; लोकसंख्या-भारित सरासरी {pw} {ug} आहे."},
}
TREND = {
    "en": {"rising": "After removing the effect of weather, {no2} has been rising by about {slope} {ug} per week over "
                     "the last {n} days, which points to increasing emissions.",
           "falling": "After removing the effect of weather, {no2} has been falling by about {slope} {ug} per week "
                      "over the last {n} days, which points to decreasing emissions.",
           "stable": "After removing the effect of weather, {no2} shows no clear trend over the last {n} days.",
           "raised": "Weather on the report day (mixing height, wind) raised {no2} by about {x} {ug} compared with a "
                     "typical day in this period.",
           "lowered": "Weather on the report day (mixing height, wind) lowered {no2} by about {x} {ug} compared with "
                      "a typical day in this period.",
           "neutral": "Weather on the report day had little effect on {no2}.",
           "r2": "Weather explains about {r2}% of the day-to-day variation.",
           "r2_low": "In this period, day-to-day changes are not explained by the weather variables."},
    "hi": {"rising": "मौसम के प्रभाव को हटाने के बाद, पिछले {n} दिनों में {no2} लगभग {slope} {ug} प्रति सप्ताह बढ़ रहा है, "
                     "जो उत्सर्जन में वृद्धि का संकेत है।",
           "falling": "मौसम के प्रभाव को हटाने के बाद, पिछले {n} दिनों में {no2} लगभग {slope} {ug} प्रति सप्ताह घट रहा है, "
                      "जो उत्सर्जन में कमी का संकेत है।",
           "stable": "मौसम के प्रभाव को हटाने के बाद, पिछले {n} दिनों में {no2} में कोई स्पष्ट रुझान नहीं दिखता।",
           "raised": "रिपोर्ट के दिन के मौसम (मिश्रण ऊँचाई, हवा) ने इस अवधि के सामान्य दिन की तुलना में {no2} को लगभग "
                     "{x} {ug} बढ़ाया।",
           "lowered": "रिपोर्ट के दिन के मौसम (मिश्रण ऊँचाई, हवा) ने इस अवधि के सामान्य दिन की तुलना में {no2} को लगभग "
                      "{x} {ug} कम किया।",
           "neutral": "रिपोर्ट के दिन मौसम का {no2} पर बहुत कम प्रभाव रहा।",
           "r2": "दैनिक उतार-चढ़ाव का लगभग {r2}% हिस्सा मौसम से समझाया जा सकता है।",
           "r2_low": "इस अवधि में दैनिक उतार-चढ़ाव को मौसम के कारकों से नहीं समझाया जा सकता।"},
    "mr": {"rising": "हवामानाचा परिणाम वगळल्यानंतर, मागील {n} दिवसांत {no2} दर आठवड्याला सुमारे {slope} {ug} ने वाढत आहे, "
                     "जे उत्सर्जनातील वाढ दर्शवते.",
           "falling": "हवामानाचा परिणाम वगळल्यानंतर, मागील {n} दिवसांत {no2} दर आठवड्याला सुमारे {slope} {ug} ने कमी होत "
                      "आहे, जे उत्सर्जनातील घट दर्शवते.",
           "stable": "हवामानाचा परिणाम वगळल्यानंतर, मागील {n} दिवसांत {no2} मध्ये कोणताही स्पष्ट कल दिसत नाही.",
           "raised": "अहवाल दिवसाच्या हवामानामुळे (मिश्रण उंची, वारा) या कालावधीतील सामान्य दिवसाच्या तुलनेत {no2} सुमारे "
                     "{x} {ug} ने वाढले.",
           "lowered": "अहवाल दिवसाच्या हवामानामुळे (मिश्रण उंची, वारा) या कालावधीतील सामान्य दिवसाच्या तुलनेत {no2} सुमारे "
                      "{x} {ug} ने कमी झाले.",
           "neutral": "अहवाल दिवशी हवामानाचा {no2} वर फारसा परिणाम झाला नाही.",
           "r2": "दैनंदिन चढ-उताराचा सुमारे {r2}% भाग हवामानामुळे स्पष्ट होतो.",
           "r2_low": "या कालावधीत दैनंदिन चढ-उतार हवामान घटकांमुळे स्पष्ट होत नाहीत."},
}
FORECAST = {
    "en": {"no_exceedance": "No exceedance of the 80 {ug} standard is expected in the next 24 hours.",
           "exceedance_expected": "Alert: {no2} is expected to exceed 80 {ug} over {share}% of the area within {h} hours.",
           "persisting": "Alert: the exceedance is expected to persist through the next 24 hours ({share}% of the area "
                         "at +24 h).",
           "localized_peak": "Localized peaks above 80 {ug} are possible within {h} hours near {place}.",
           "improving": "Conditions are expected to improve: the area above the standard falls to {share}% by +24 h.",
           "wind": "Wind: {speed} m/s from the {dir}. The forecast assumes today's wind persists and is indicative."},
    "hi": {"no_exceedance": "अगले 24 घंटों में 80 {ug} मानक से अधिक होने की संभावना नहीं है।",
           "exceedance_expected": "चेतावनी: {h} घंटों के भीतर क्षेत्र के {share}% हिस्से में {no2} के 80 {ug} से अधिक होने "
                                  "की संभावना है।",
           "persisting": "चेतावनी: मानक से अधिकता अगले 24 घंटों तक बनी रहने की संभावना है (+24 घंटे पर क्षेत्र का "
                         "{share}%)।",
           "localized_peak": "{h} घंटों के भीतर {place} के पास 80 {ug} से ऊपर स्थानीय उच्च स्तर संभव हैं।",
           "improving": "स्थिति में सुधार की संभावना है: +24 घंटे तक मानक से ऊपर का क्षेत्र घटकर {share}% रह जाएगा।",
           "wind": "हवा: {dir} दिशा से {speed} मी./से.। यह पूर्वानुमान मानता है कि आज की हवा बनी रहेगी, और यह संकेतात्मक है।"},
    "mr": {"no_exceedance": "पुढील 24 तासांत 80 {ug} मानक ओलांडले जाण्याची शक्यता नाही.",
           "exceedance_expected": "इशारा: {h} तासांच्या आत क्षेत्राच्या {share}% भागात {no2} 80 {ug} पेक्षा जास्त होण्याची "
                                  "शक्यता आहे.",
           "persisting": "इशारा: मानकापेक्षा जास्त पातळी पुढील 24 तास कायम राहण्याची शक्यता आहे (+24 तासांवर क्षेत्राचा "
                         "{share}%).",
           "localized_peak": "{h} तासांच्या आत {place} जवळ 80 {ug} पेक्षा जास्त स्थानिक उच्च पातळी शक्य आहे.",
           "improving": "परिस्थिती सुधारण्याची शक्यता आहे: +24 तासांपर्यंत मानकापेक्षा जास्त क्षेत्र {share}% पर्यंत कमी होईल.",
           "wind": "वारा: {dir} दिशेकडून {speed} मी./से. हा अंदाज आजचा वारा कायम राहील असे गृहीत धरतो, आणि तो सूचक आहे."},
}
RISK = {
    "en": "{advice} Children, older adults and people with asthma or heart disease are the most sensitive to {no2}. "
          "The main hotspots coincide with {sources}, which suggests these are the leading contributors in this area.",
    "hi": "{advice} बच्चे, बुज़ुर्ग और अस्थमा या हृदय रोग से पीड़ित लोग {no2} के प्रति सबसे अधिक संवेदनशील होते हैं। मुख्य "
          "हॉटस्पॉट {sources} के साथ मेल खाते हैं, जिससे संकेत मिलता है कि इस क्षेत्र में यही प्रमुख स्रोत हैं।",
    "mr": "{advice} लहान मुले, ज्येष्ठ नागरिक आणि दमा किंवा हृदयविकार असलेले लोक {no2} साठी सर्वाधिक संवेदनशील असतात. मुख्य "
          "हॉटस्पॉट {sources} यांच्याशी जुळतात, यावरून या क्षेत्रातील हेच प्रमुख स्रोत असल्याचे दिसते.",
}
RECOMMENDATIONS = {
    "en": {
        "normal": ["Continue routine monitoring; no special measures are required.",
                   "Use this period as a baseline for comparing future changes.",
                   "Keep traffic and industrial emission controls in place."],
        "elevated": ["Advise sensitive groups to limit prolonged outdoor exertion near busy roads.",
                     "Increase monitoring at the listed hotspots.",
                     "Enforce anti-idling rules and smooth traffic flow on congested corridors.",
                     "Check industrial units near the hotspots for compliance with emission norms."],
        "critical": ["Issue a public health advisory for the affected wards.",
                     "Restrict heavy-vehicle movement on hotspot corridors during peak hours.",
                     "Order inspections of large combustion sources near the hotspots.",
                     "Advise schools and hospitals in affected areas to reduce outdoor activity.",
                     "Review the situation daily until levels fall below the standard."],
        "critical_spike": ["Trigger emergency traffic and industrial reduction measures (SRS Hazardous band).",
                           "Issue an immediate health alert; advise everyone to avoid outdoor exertion.",
                           "Suspend non-essential construction and heavy-vehicle entry in affected zones.",
                           "Coordinate with the pollution control board for on-site inspections today."],
        "forecast": "Prepare advisories now: an exceedance is forecast within {h} hours.",
    },
    "hi": {
        "normal": ["नियमित निगरानी जारी रखें; किसी विशेष उपाय की आवश्यकता नहीं है।",
                   "भविष्य के बदलावों की तुलना के लिए इस अवधि को आधार के रूप में उपयोग करें।",
                   "यातायात और औद्योगिक उत्सर्जन नियंत्रण लागू रखें।"],
        "elevated": ["संवेदनशील समूहों को व्यस्त सड़कों के पास लंबे समय तक बाहर परिश्रम सीमित करने की सलाह दें।",
                     "सूचीबद्ध हॉटस्पॉट पर निगरानी बढ़ाएँ।",
                     "भीड़भाड़ वाले मार्गों पर एंटी-आइडलिंग नियम लागू करें और यातायात सुचारू रखें।",
                     "हॉटस्पॉट के पास औद्योगिक इकाइयों द्वारा उत्सर्जन मानकों के अनुपालन की जाँच करें।"],
        "critical": ["प्रभावित वार्डों के लिए जन स्वास्थ्य परामर्श जारी करें।",
                     "व्यस्त समय में हॉटस्पॉट मार्गों पर भारी वाहनों की आवाजाही सीमित करें।",
                     "हॉटस्पॉट के पास बड़े दहन स्रोतों के निरीक्षण के आदेश दें।",
                     "प्रभावित क्षेत्रों के स्कूलों और अस्पतालों को बाहरी गतिविधियाँ कम करने की सलाह दें।",
                     "स्तर मानक से नीचे आने तक प्रतिदिन स्थिति की समीक्षा करें।"],
        "critical_spike": ["आपातकालीन यातायात और औद्योगिक कटौती उपाय लागू करें (SRS खतरनाक श्रेणी)।",
                           "तत्काल स्वास्थ्य चेतावनी जारी करें; सभी को बाहरी परिश्रम से बचने की सलाह दें।",
                           "प्रभावित क्षेत्रों में गैर-आवश्यक निर्माण और भारी वाहनों का प्रवेश रोकें।",
                           "आज ही स्थल निरीक्षण के लिए प्रदूषण नियंत्रण बोर्ड से समन्वय करें।"],
        "forecast": "अभी से परामर्श तैयार रखें: {h} घंटों के भीतर मानक से अधिकता का पूर्वानुमान है।",
    },
    "mr": {
        "normal": ["नियमित देखरेख सुरू ठेवा; कोणत्याही विशेष उपायांची गरज नाही.",
                   "भविष्यातील बदलांची तुलना करण्यासाठी हा कालावधी आधाररेषा म्हणून वापरा.",
                   "वाहतूक व औद्योगिक उत्सर्जन नियंत्रणे लागू ठेवा."],
        "elevated": ["संवेदनशील गटांना गर्दीच्या रस्त्यांजवळ दीर्घकाळ बाहेर श्रम टाळण्याचा सल्ला द्या.",
                     "सूचीतील हॉटस्पॉटवर देखरेख वाढवा.",
                     "गर्दीच्या मार्गांवर अँटी-आयडलिंग नियम लागू करा आणि वाहतूक सुरळीत ठेवा.",
                     "हॉटस्पॉटजवळील औद्योगिक युनिट्स उत्सर्जन मानकांचे पालन करतात का ते तपासा."],
        "critical": ["बाधित प्रभागांसाठी सार्वजनिक आरोग्य सूचना जारी करा.",
                     "गर्दीच्या वेळेत हॉटस्पॉट मार्गांवर अवजड वाहनांची वाहतूक मर्यादित करा.",
                     "हॉटस्पॉटजवळील मोठ्या ज्वलन स्रोतांच्या तपासणीचे आदेश द्या.",
                     "बाधित भागांतील शाळा व रुग्णालयांना बाहेरील क्रियाकलाप कमी करण्याचा सल्ला द्या.",
                     "पातळी मानकाखाली येईपर्यंत दररोज परिस्थितीचा आढावा घ्या."],
        "critical_spike": ["आपत्कालीन वाहतूक व औद्योगिक कपात उपाय लागू करा (SRS धोकादायक श्रेणी).",
                           "तत्काळ आरोग्य इशारा जारी करा; सर्वांना बाहेरील श्रम टाळण्याचा सल्ला द्या.",
                           "बाधित भागांत अनावश्यक बांधकाम व अवजड वाहनांचा प्रवेश थांबवा.",
                           "आजच स्थळ तपासणीसाठी प्रदूषण नियंत्रण मंडळाशी समन्वय साधा."],
        "forecast": "आत्ताच सूचना तयार ठेवा: {h} तासांच्या आत मानक ओलांडले जाण्याचा अंदाज आहे.",
    },
}
METHOD = {
    "en": "Maps are produced by the {no2} ML engine from Sentinel-5P satellite data (cloud gaps filled by a Random "
          "Forest, downscaled to about {res} m with XGBoost) and converted to ground-level concentrations by a model "
          "trained on 212 CPCB stations in 115 cities. On cities it never saw, this model explains about {r2}% of the "
          "variation, with a typical error of ±{rmse} {ug} for a single day at a single location. Use the values for "
          "patterns, hotspots and trends rather than as exact measurements, and confirm critical findings with ground "
          "monitoring. Standards: CPCB NAAQS {no2} 24-hour 80 {ug}, annual 40 {ug}; WHO 2021 24-hour guideline 25 {ug}. "
          "Population: GHSL. Forecast: advection–diffusion model with the day's ERA5 wind.",
    "hi": "मानचित्र {no2} ML इंजन द्वारा Sentinel-5P उपग्रह डेटा से बनाए गए हैं (बादलों से खाली हिस्से Random Forest से भरे गए, "
          "XGBoost से लगभग {res} मी. तक सूक्ष्म किए गए) और 115 शहरों के 212 CPCB स्टेशनों पर प्रशिक्षित मॉडल द्वारा ज़मीनी "
          "स्तर की सांद्रता में बदले गए। जिन शहरों को मॉडल ने कभी नहीं देखा, वहाँ यह लगभग {r2}% उतार-चढ़ाव समझाता है, और किसी "
          "एक स्थान पर एक दिन के लिए सामान्य त्रुटि ±{rmse} {ug} है। मानों का उपयोग सटीक माप के बजाय पैटर्न, हॉटस्पॉट और "
          "रुझानों के लिए करें, और गंभीर निष्कर्षों की पुष्टि ज़मीनी निगरानी से करें। मानक: CPCB NAAQS {no2} 24-घंटे 80 {ug}, "
          "वार्षिक 40 {ug}; WHO 2021 24-घंटे दिशानिर्देश 25 {ug}। जनसंख्या: GHSL। पूर्वानुमान: उस दिन की ERA5 हवा के साथ "
          "एडवेक्शन–डिफ्यूज़न मॉडल।",
    "mr": "नकाशे {no2} ML इंजिनद्वारे Sentinel-5P उपग्रह माहितीवरून तयार केले आहेत (ढगांमुळे रिकामे भाग Random Forest ने "
          "भरले, XGBoost ने सुमारे {res} मी. पर्यंत सूक्ष्म केले) आणि 115 शहरांतील 212 CPCB स्थानकांवर प्रशिक्षित मॉडेलद्वारे "
          "जमिनीलगतच्या सांद्रतेत रूपांतरित केले आहेत. मॉडेलने कधीही न पाहिलेल्या शहरांमध्ये ते सुमारे {r2}% चढ-उतार स्पष्ट "
          "करते, आणि एका ठिकाणी एका दिवसासाठी सामान्य त्रुटी ±{rmse} {ug} आहे. मूल्यांचा वापर अचूक मोजमापाऐवजी नमुने, "
          "हॉटस्पॉट आणि कल यांसाठी करा, आणि गंभीर निष्कर्षांची खात्री जमिनीवरील देखरेखीने करा. मानके: CPCB NAAQS {no2} "
          "24-तास 80 {ug}, वार्षिक 40 {ug}; WHO 2021 24-तास मार्गदर्शक 25 {ug}. लोकसंख्या: GHSL. अंदाज: त्या दिवसाच्या ERA5 "
          "वाऱ्यासह ॲडव्हेक्शन–डिफ्यूजन मॉडेल.",
}


def t(lang: str, key: str) -> str:
    return T[lang][key]


def fmt_date(date: str, lang: str) -> str:
    d = pd.Timestamp(date)
    return f"{d.day} {MONTHS[lang][d.month - 1]} {d.year}"


def fmt_people(n: float, lang: str) -> str:
    """Readable population counts (million in English; lakh / crore in Hindi and Marathi)."""
    if lang == "en":
        return f"{n / 1e6:.1f} million" if n >= 1e6 else f"{n:,.0f}"
    crore, lakh = {"hi": ("करोड़", "लाख"), "mr": ("कोटी", "लाख")}[lang]
    if n >= 1e7:
        return f"{n / 1e7:.1f} {crore}"
    if n >= 1e5:
        return f"{n / 1e5:.1f} {lakh}"
    return f"{n:,.0f}"


def pct(share: float) -> str:
    return f"{share * 100:.0f}"


def _sources_phrase(facts: dict, lang: str) -> str:
    keys = []
    for h in facts["hotspots"]:
        for s in h["sources"]:
            if s not in keys:
                keys.append(s)
    names = [SOURCE[lang][k] for k in keys] or [SOURCE[lang]["background"]]
    joiner = {"en": ", ", "hi": ", ", "mr": ", "}[lang]
    return joiner.join(names)


def summary_text(facts: dict, lang: str) -> str:
    cur = facts["current"]
    text = SUMMARY[lang].format(
        date=fmt_date(facts["date"], lang), area=facts["area"]["name"], no2=NO2, ug=UG, mean=f"{cur['mean']:.0f}",
        pct=f"{abs(cur['pct_vs_naaqs']):.0f}", dir=T[lang]["above"] if cur["pct_vs_naaqs"] > 0 else T[lang]["below"],
        status=STATUS[lang][cur["status"]], share=pct(cur["share_above_naaqs"]), max=f"{cur['max']:.0f}",
        near=cur["max_near"])
    parts = [text]
    pt = facts.get("point")
    if pt and pt.get("value") is not None:
        parts.append(T[lang]["point_line"].format(name=pt["name"], value=f"{pt['value']:.0f}", ug=UG,
                                                  band=BAND[lang][band_key(pt["value"])]))
    if facts.get("population"):
        parts.append(population_text(facts, lang))
    if facts.get("trend"):
        parts.append(TREND[lang][facts["trend"]["direction"]].format(
            no2=NO2, ug=UG, slope=f"{abs(facts['trend']['slope_adjusted_per_week']):.1f}", n=facts["trend"]["days"]))
    return " ".join(parts)


def population_text(facts: dict, lang: str) -> str:
    p = facts["population"]
    key = "some" if p["above_naaqs"] > 0 else "none"
    return POPULATION[lang][key].format(people=fmt_people(p["above_naaqs"], lang), share=pct(p["share_above_naaqs"]),
                                        pw=f"{p['weighted_mean']:.0f}", no2=NO2, ug=UG)


def trend_texts(facts: dict, lang: str) -> list[str]:
    tr = facts.get("trend")
    if not tr:
        return [T[lang]["no_trend"]]
    return [
        TREND[lang][tr["direction"]].format(no2=NO2, ug=UG, slope=f"{abs(tr['slope_adjusted_per_week']):.1f}", n=tr["days"]),
        TREND[lang][tr["weather_role"]].format(no2=NO2, ug=UG, x=f"{abs(tr['weather_effect_today']):.0f}"),
        TREND[lang]["r2"].format(r2=f"{tr['weather_r2'] * 100:.0f}") if tr["weather_r2"] >= 0.05 else TREND[lang]["r2_low"],
    ]


def forecast_texts(facts: dict, lang: str) -> list[str]:
    fc = facts["forecast"]
    if not fc["alerts"]:
        return [T[lang]["no_forecast"]]
    lines = [FORECAST[lang][a["code"]].format(no2=NO2, ug=UG, h=a["hours"], share=pct(a["share"]),
                                               place=a.get("place") or facts["current"]["max_near"])
             for a in fc["alerts"]]
    if fc["wind_speed"] is not None:
        lines.append(FORECAST[lang]["wind"].format(speed=f"{fc['wind_speed']:.1f}", dir=COMPASS[lang][fc["wind_compass"]]))
    return lines


def risk_text(facts: dict, lang: str) -> str:
    return RISK[lang].format(advice=BAND_ADVICE[lang][facts["current"]["band"]], no2=NO2,
                             sources=_sources_phrase(facts, lang))


def recommendations(facts: dict, lang: str) -> list[str]:
    items = list(RECOMMENDATIONS[lang][facts["current"]["status"]])
    for a in facts["forecast"]["alerts"]:
        if a["code"] == "exceedance_expected":
            items.insert(0, RECOMMENDATIONS[lang]["forecast"].format(h=a["hours"]))
    return items


REASON = {
    "en": {"processing": "new satellite data is still being processed; it continues in the background",
           "quota": "satellite data service usage limit reached", "config": "satellite data service not configured",
           "network": "satellite data service could not be reached",
           "no_data": "no satellite data available for these dates", "error": "processing error",
           "offline": "live satellite updates are paused",
           "no_model": "no satellite model map covers this location yet (upload satellite files for it)"},
    "hi": {"processing": "नया उपग्रह डेटा अभी संसाधित हो रहा है; यह पृष्ठभूमि में जारी है",
           "quota": "उपग्रह डेटा सेवा की उपयोग सीमा पूरी हो गई", "config": "उपग्रह डेटा सेवा कॉन्फ़िगर नहीं है",
           "network": "उपग्रह डेटा सेवा से संपर्क नहीं हो सका",
           "no_data": "इन तिथियों के लिए उपग्रह डेटा उपलब्ध नहीं है", "error": "प्रसंस्करण त्रुटि",
           "offline": "लाइव उपग्रह अपडेट रोके गए हैं",
           "no_model": "इस स्थान के लिए अभी कोई उपग्रह मॉडल मानचित्र नहीं है (इसके लिए उपग्रह फ़ाइलें अपलोड करें)"},
    "mr": {"processing": "नवीन उपग्रह डेटावर अजून प्रक्रिया सुरू आहे; ती पार्श्वभूमीत चालू राहील",
           "quota": "उपग्रह डेटा सेवेची वापर मर्यादा संपली", "config": "उपग्रह डेटा सेवा कॉन्फिगर केलेली नाही",
           "network": "उपग्रह डेटा सेवेशी संपर्क होऊ शकला नाही",
           "no_data": "या तारखांसाठी उपग्रह डेटा उपलब्ध नाही", "error": "प्रक्रिया त्रुटी",
           "offline": "थेट उपग्रह अद्यतने थांबवली आहेत",
           "no_model": "या ठिकाणासाठी अद्याप उपग्रह मॉडेल नकाशा नाही (त्यासाठी उपग्रह फायली अपलोड करा)"},
}


def notice_text(notice: dict, lang: str) -> str:
    """Why a report uses an older map, or has no map at all."""
    key = "notice_cached" if notice["code"] == "cached" else "notice_unavailable"
    used = fmt_date(notice["used_date"], lang) if notice.get("used_date") else ""
    reason = REASON[lang].get(notice["reason"], REASON[lang]["error"])
    return T[lang][key].format(requested=fmt_date(notice["requested_date"], lang), used=used, reason=reason)


def source_text(facts: dict, lang: str) -> str | None:
    """Where the report's numbers come from (model upload / model run / Google point value)."""
    src = facts.get("data_source")
    if not src:
        return None
    if src["kind"] == "upload":
        return T[lang]["src_upload"].format(days=src.get("days", "?"), first=fmt_date(src["first_date"], lang),
                                            last=fmt_date(src["last_date"], lang))
    if src["kind"] == "run":
        return T[lang]["src_run"]
    return T[lang]["src_google"].format(lat=f"{src['lat']:.3f}", lon=f"{src['lon']:.3f}", time=src.get("time") or "—",
                                        raw=f"{src['raw_value']:.1f}", units=src.get("raw_units", "").lower().replace("_", " "))


def point_summary(pf: dict, lang: str) -> str:
    diff = (pf["value"] - 80) / 80 * 100
    return T[lang]["point_summary"].format(date=fmt_date(pf["date"], lang), area=pf["area"]["name"], value=f"{pf['value']:.0f}",
                                           ug=UG, pct=f"{abs(diff):.0f}", dir=T[lang]["above"] if diff > 0 else T[lang]["below"],
                                           status=STATUS[lang][pf["status"]])


def method_text(facts: dict, lang: str) -> str:
    m = facts["model"]
    return METHOD[lang].format(no2=NO2, ug=UG, res=facts["data"]["resolution_m"],
                               r2=f"{(m['unseen_city_r2'] or 0) * 100:.0f}", rmse=m["rmse"] or "—")
