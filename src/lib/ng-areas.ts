// ── Area suggestions per state on the order form (Bright, 5 Nov 2026) ───────
// A Lagos customer who picks Lagos sees Lagos areas to tap, not a blank box.
// Most people typed the state again ("Lagos" was the city on 321 of 815
// delivered Lagos orders), which tells a rider nothing.
//
// Each list starts with the places our DELIVERED orders came from most (prod,
// 5 Nov 2026), then well-known areas and towns. A suggestion is only a help:
// the customer can still type any place that is not listed.
// Keys match NIGERIA_STATES in ./nigeria (including "FCT Abuja").

export const STATE_AREAS: Record<string, string[]> = {
  "Lagos": ["Ikeja", "Ikorodu", "Surulere", "Lekki", "Ajah", "Apapa", "Alimosho", "Ikoyi", "Ojo", "Lagos Island", "Victoria Island", "Yaba", "Festac", "Gbagada", "Ogba", "Agege", "Oshodi", "Isolo", "Mushin", "Maryland", "Ojota", "Ketu", "Magodo", "Egbeda", "Ikotun", "Ipaja", "Ejigbo", "Sangotedo", "Badagry", "Epe", "Ojodu", "Berger", "Iyana Ipaja", "Amuwo Odofin", "Satellite Town", "Okota", "Ilupeju", "Ebute Metta", "Oregun", "Ibeju-Lekki", "Abule Egba", "Idimu", "Ayobo", "Ogudu", "Anthony", "Bariga", "Somolu", "Ikate", "Chevron", "Osapa", "Igando", "Akowonjo", "Isheri", "Ijora", "Orile"],
  "FCT Abuja": ["Lugbe", "Kubwa", "Asokoro", "Gwarinpa", "Gwagwalada", "Lokogoma", "Wuse", "Garki", "Maitama", "Jabi", "Utako", "Wuye", "Life Camp", "Apo", "Karu", "Nyanya", "Dutse", "Bwari", "Kuje", "Kwali", "Galadimawa", "Durumi", "Katampe", "Jahi", "Kado", "Idu", "Dawaki", "Karmo", "Mpape", "Zuba", "Gudu", "Dei-Dei", "Kabusa", "Central Area"],
  "Rivers": ["Port Harcourt", "Eleme", "Bonny", "Oyigbo", "Onne", "Obio-Akpor", "Rumuokoro", "Rumuola", "Trans Amadi", "GRA Port Harcourt", "D-Line", "Choba", "Rumuodara", "Eliozu", "Woji", "Rumuomasi", "Ada George", "Rumuigbo", "Elelenwo", "Borokiri", "Diobu", "Mile 1", "Mile 3", "Rumuolumeni", "Igwuruta", "Aluu", "Ahoada", "Omoku", "Bori", "Okrika"],
  "Oyo": ["Ibadan", "Ogbomoso", "Oyo", "Saki", "Bodija", "Challenge", "Dugbe", "Mokola", "Ring Road", "Apata", "Iwo Road", "Akobo", "Agodi", "Moniya", "Ojoo", "Sango", "Oluyole", "Iseyin", "Eruwa", "Igboho", "Igbo-Ora", "Kishi", "Lanlate", "Olorunda"],
  "Delta": ["Warri", "Asaba", "Sapele", "Ughelli", "Udu", "Agbor", "Bomadi", "Effurun", "Ekpan", "Okpanam", "Ibusa", "Ogwashi-Uku", "Kwale", "Oleh", "Abraka", "Oghara", "Ozoro", "Issele-Uku", "Obiaruku", "Burutu", "Koko", "Uvwie"],
  "Edo": ["Benin City", "Auchi", "Ekpoma", "Uromi", "Igarra", "Irrua", "Ugbowo", "Uselu", "Ikpoba Hill", "Sapele Road", "GRA Benin", "Oluku", "Okada", "Igueben", "Ubiaja", "Fugar", "Afuze", "Ehor", "Iguobazuwa", "Ugbor"],
  "Anambra": ["Onitsha", "Awka", "Nnewi", "Nkpor", "Oba", "Ekwulobia", "Ogidi", "Obosi", "Ihiala", "Amawbia", "Nnobi", "Agulu", "Otuocha", "Ozubulu", "Igbo-Ukwu", "Uli", "Umunze", "Ajalli", "Atani", "Fegge", "Okpoko", "Abagana"],
  "Ogun": ["Abeokuta", "Sagamu", "Ijebu Ode", "Ota", "Ilaro", "Mowe", "Ibafo", "Sango Ota", "Ifo", "Owode", "Ilishan-Remo", "Agbara", "Akute", "Arepo", "Magboro", "Ogijo", "Ikenne", "Ijebu-Igbo", "Ago-Iwoye", "Itele", "Ayetoro", "Ewekoro", "Abule Ijoko", "Ijoko"],
  "Akwa Ibom": ["Uyo", "Eket", "Ikot Ekpene", "Ibeno", "Ikot Abasi", "Abak", "Oron", "Etinan", "Itu", "Uruan", "Afaha Nsit", "Mkpat Enin", "Essien Udim", "Ukanafun", "Ibesikpo", "Nsit Ubium", "Onna", "Ikono", "Ewet Housing"],
  "Imo": ["Owerri", "Mbaise", "Orlu", "Okigwe", "New Owerri", "Ikenegbu", "World Bank", "Obinze", "Nekede", "Ihiagwa", "Mbieri", "Oguta", "Mgbidi", "Nkwerre", "Awo-Omamma", "Umuguma", "Egbu", "Amakohia", "Naze", "Isiala Mbano", "Ohaji"],
  "Enugu": ["Enugu", "Nsukka", "Abakpa Nike", "Emene", "Independence Layout", "New Haven", "Trans-Ekulu", "GRA Enugu", "Uwani", "Achara Layout", "Asata", "Coal Camp", "Ogui", "Agbani", "Udi", "Oji River", "Awgu", "9th Mile", "Ugwuaji", "Obollo-Afor", "Nkanu"],
  "Abia": ["Aba", "Umuahia", "Ohafia", "Arochukwu", "Abiriba", "Isuikwuato", "Bende", "Nbawsi", "Osisioma", "Ariaria", "Uturu", "Ngwa Road", "Ogbor Hill"],
  "Cross River": ["Calabar", "Ikom", "Ogoja", "Calabar South", "Calabar Municipal", "Obudu", "Ugep", "Akamkpa", "Odukpani", "Obubra", "Akpabuyo", "Boki", "Akim", "Marian"],
  "Kaduna": ["Kaduna", "Zaria", "Kafanchan", "Sabon Tasha", "Barnawa", "Ungwan Rimi", "Malali", "Kawo", "Rigasa", "Tudun Wada", "Narayi", "Mando", "Kakuri", "Gonin Gora", "Kagoro", "Saminaka", "Zonkwa", "Pambegua", "Makarfi"],
  "Kwara": ["Ilorin", "Offa", "Kaiama", "Erin-Ile", "Omu-Aran", "Jebba", "Lafiagi", "Patigi", "Tanke", "Fate", "GRA Ilorin", "Oro", "Share", "Igbaja", "Oke-Oyi"],
  "Osun": ["Osogbo", "Ile-Ife", "Ikirun", "Iwo", "Ikire", "Ede", "Ilesa", "Ila", "Ilobu", "Iree", "Ejigbo", "Modakeke", "Gbongan", "Ipetumodu", "Esa-Oke"],
  "Plateau": ["Jos", "Bukuru", "Rayfield", "Jos North", "Jos South", "Terminus", "Tudun Wada", "Rantya", "Pankshin", "Shendam", "Langtang", "Barkin Ladi", "Vom", "Mangu", "Bassa"],
  "Kano": ["Kano", "Nassarawa GRA", "Sabon Gari", "Tarauni", "Fagge", "Gwale", "Kumbotso", "Ungogo", "Dala", "Bompai", "Hotoro", "Sharada", "Wudil", "Rano", "Gaya", "Bichi", "Rogo", "Yankaba"],
  "Ondo": ["Akure", "Ondo City", "Ore", "Owo", "Akungba-Akoko", "Ikare-Akoko", "Okitipupa", "Oka-Akoko", "Idanre", "Igbokoda", "Ifon", "Ile-Oluji", "Oba-Ile", "Ijapo"],
  "Bayelsa": ["Yenagoa", "Tombia", "Amassoma", "Ogbia", "Brass", "Sagbama", "Kaiama", "Nembe", "Opolo", "Swali", "Agudama", "Okaka", "Edepie", "Kpansia", "Ekeki"],
  "Ekiti": ["Ado-Ekiti", "Ikere-Ekiti", "Ido-Ekiti", "Osi-Ekiti", "Omuo", "Oye-Ekiti", "Ikole", "Ijero", "Efon-Alaaye", "Emure", "Ise-Ekiti", "Aramoko", "Iyin", "Igede"],
  "Ebonyi": ["Abakaliki", "Afikpo", "Onueke", "Ezzamgbo", "Ishieke", "Ohaozara", "Ikwo", "Ezza", "Edda", "Ishiagu", "Uburu", "Nkalagu"],
  "Kogi": ["Lokoja", "Anyigba", "Idah", "Okene", "Kabba", "Obajana", "Ankpa", "Isanlu", "Egbe", "Ajaokuta", "Dekina", "Koton Karfe", "Ogori", "Ejule"],
  "Niger": ["Minna", "Suleja", "Madalla", "Kontagora", "Bida", "New Bussa", "Lapai", "Mokwa", "Zungeru", "Kuta", "Sabon Wuse", "Agaie", "Rijau"],
  "Benue": ["Makurdi", "Gboko", "Otukpo", "Katsina-Ala", "Vandeikya", "Adikpo", "Zaki Biam", "Aliade", "Naka", "Ugbokpo", "Oju", "Okpoga", "Wannune"],
  "Adamawa": ["Jimeta", "Yola", "Mubi", "Numan", "Gombi", "Ganye", "Michika", "Hong", "Song", "Girei", "Jada", "Mayo-Belwa"],
  "Nasarawa": ["Lafia", "Karu", "Keffi", "New Karu", "Mararaba", "Masaka", "Garaku", "Akwanga", "Nasarawa", "Doma", "Obi", "Awe", "Wamba", "Auta Balefi"],
  "Taraba": ["Jalingo", "Wukari", "Gembu", "Bali", "Zing", "Takum", "Serti", "Ibi", "Gashaka", "Mutum Biyu", "Donga"],
  "Borno": ["Maiduguri", "Biu", "Bama", "Konduga", "Jere", "Gwoza", "Monguno", "Dikwa", "Damboa", "Mafa"],
  "Bauchi": ["Bauchi", "Azare", "Misau", "Jama'are", "Ningi", "Tafawa Balewa", "Dass", "Toro", "Alkaleri", "Darazo"],
  "Katsina": ["Katsina", "Daura", "Funtua", "Malumfashi", "Dutsin-Ma", "Kankia", "Mani", "Bakori", "Kankara", "Jibia"],
  "Kebbi": ["Birnin Kebbi", "Zuru", "Jega", "Argungu", "Yauri", "Bunza", "Koko", "Kalgo"],
  "Gombe": ["Gombe", "Kaltungo", "Billiri", "Dukku", "Bajoga", "Kumo", "Deba", "Nafada", "Tula"],
  "Sokoto": ["Sokoto", "Wamakko", "Tambuwal", "Gwadabawa", "Illela", "Bodinga", "Dange", "Wurno", "Isa"],
  "Yobe": ["Damaturu", "Potiskum", "Gashua", "Nguru", "Geidam", "Fika", "Gujba", "Buni Yadi"],
  "Zamfara": ["Gusau", "Kaura Namoda", "Talata Mafara", "Anka", "Tsafe", "Bungudu", "Shinkafi", "Maru", "Gummi"],
  "Jigawa": ["Dutse", "Hadejia", "Gumel", "Kazaure", "Birnin Kudu", "Ringim", "Kafin Hausa", "Babura"]
};

const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Areas to offer for a state, narrowed by what is typed so far: names that
 * start with it first, then names that contain it. Nothing when the box
 * already holds one of the areas exactly.
 */
export function areaSuggestions(state: string, typed: string, limit = 8): string[] {
  const areas = STATE_AREAS[state] ?? [];
  const query = fold(typed);
  if (!query) return areas.slice(0, limit);
  if (areas.some((area) => fold(area) === query)) return [];
  const starts = areas.filter((area) => fold(area).startsWith(query) || area.toLowerCase().split(/[\s-]+/).some((word) => fold(word).startsWith(query)));
  const contains = areas.filter((area) => !starts.includes(area) && fold(area).includes(query));
  return [...starts, ...contains].slice(0, limit);
}
