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
/** Every area name above, for the address check (nigeria.ts vagueAddressReason). */
export const KNOWN_AREA_NAMES: readonly string[] = Object.values(STATE_AREAS).flat();

export function areaSuggestions(state: string, typed: string, limit = 8): string[] {
  const areas = STATE_AREAS[state] ?? [];
  const query = fold(typed);
  if (!query) return areas.slice(0, limit);
  if (areas.some((area) => fold(area) === query)) return [];
  const starts = areas.filter((area) => fold(area).startsWith(query) || area.toLowerCase().split(/[\s-]+/).some((word) => fold(word).startsWith(query)));
  const contains = areas.filter((area) => !starts.includes(area) && fold(area).includes(query));
  return [...starts, ...contains].slice(0, limit);
}

// ── An address example from the customer's own state (Bright, 5 Nov 2026) ──
// "e.g. 12 Aba Road, Rumuola" means nothing to someone in Kano. Each state
// gets an example on a well-known road with a landmark, shown under the
// street box and in the "please add more" message.
export const STATE_ADDRESS_EXAMPLE: Record<string, string> = {
  "Lagos": "12 Allen Avenue, Ikeja, near Ikeja City Mall",
  "FCT Abuja": "12 Aminu Kano Crescent, Wuse 2, near Banex Plaza",
  "Rivers": "12 Aba Road, Rumuola, near Rumuola Junction",
  "Oyo": "12 Ring Road, Ibadan, near Challenge",
  "Delta": "12 Nnebisi Road, Asaba, near Ogbeogonogo Market",
  "Edo": "12 Sapele Road, Benin City, near Ring Road",
  "Anambra": "12 Zik Avenue, Awka, near Eke Awka Market",
  "Ogun": "12 Oke-Ilewo Road, Abeokuta, near Panseke",
  "Akwa Ibom": "12 Oron Road, Uyo, near Ibom Plaza",
  "Imo": "12 Wetheral Road, Owerri, near Ikenegbu",
  "Enugu": "12 Ogui Road, Enugu, near Ogbete Market",
  "Abia": "12 Faulks Road, Aba, near Ariaria Market",
  "Cross River": "12 Marian Road, Calabar, near Watt Market",
  "Kaduna": "12 Ahmadu Bello Way, Kaduna, near Central Market",
  "Kwara": "12 Unity Road, Ilorin, near Challenge",
  "Osun": "12 Gbongan Road, Osogbo, near Olaiya Junction",
  "Plateau": "12 Ahmadu Bello Way, Jos, near Terminus Market",
  "Kano": "12 Murtala Mohammed Way, Kano, near Sabon Gari Market",
  "Ondo": "12 Oyemekun Road, Akure, near Oja Oba",
  "Bayelsa": "12 Mbiama-Yenagoa Road, Yenagoa, near Tombia Roundabout",
  "Ekiti": "12 New Iyin Road, Ado-Ekiti, near Fajuyi Park",
  "Ebonyi": "12 Ogoja Road, Abakaliki, near Abakpa Market",
  "Kogi": "12 IBB Way, Lokoja, near Ganaja Junction",
  "Niger": "12 Bosso Road, Minna, near Bosso Market",
  "Benue": "12 Old Otukpo Road, Makurdi, near Wurukum Market",
  "Adamawa": "12 Atiku Abubakar Road, Jimeta, near Jimeta Market",
  "Nasarawa": "12 Jos Road, Lafia, near Lafia Main Market",
  "Taraba": "12 Hammaruwa Way, Jalingo, near Jalingo Main Market",
  "Borno": "12 Baga Road, Maiduguri, near Monday Market",
  "Bauchi": "12 Murtala Mohammed Way, Bauchi, near Wunti Market",
  "Katsina": "12 IBB Way, Katsina, near Central Market",
  "Kebbi": "12 Ahmadu Bello Way, Birnin Kebbi, near Central Market",
  "Gombe": "12 Biu Road, Gombe, near Gombe Main Market",
  "Sokoto": "12 Sultan Abubakar Road, Sokoto, near Central Market",
  "Yobe": "12 Potiskum Road, Damaturu, near Damaturu Market",
  "Zamfara": "12 Sokoto Road, Gusau, near Gusau Central Market",
  "Jigawa": "12 Kiyawa Road, Dutse, near Dutse Market"
};

/** The example for a state; a neutral one before a state is picked. */
export const addressExampleFor = (state?: string | null) =>
  STATE_ADDRESS_EXAMPLE[String(state ?? "")] ?? "12 Main Road, your area, near a place everyone knows";
