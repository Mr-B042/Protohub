// What a prospective Personal Delivery Agent must provide before a reviewer can
// do anything useful with their application.
//
// This lives in lib/ rather than the route because it is the rule, not the
// plumbing: the browser form runs the same checks as a courtesy, but a public
// endpoint has to assume the browser was skipped entirely. Someone who will
// hold our stock and our customers' cash does not get in on a half-filled form.
import { z } from "zod";

// EVERY rule carries its own words. The route shows the first failing message
// to the applicant verbatim, so a rule without a message shows them Zod's
// English instead - "Array must contain at most 20 element(s)" is what a real
// applicant was told, and it names nothing they can act on. A limit is a
// sentence to somebody filling in a form on a phone, not a constraint.
const tooLong = (what: string, n: number) => `${what} is too long - keep it under ${n} characters.`;

const GuarantorSchema = z.object({
  fullName: z.string({ required_error: "Enter each guarantor's full name.", invalid_type_error: "Enter each guarantor's full name." }).trim().min(2, "Enter each guarantor's full name.").max(160, tooLong("A guarantor's name", 160)),
  // A guarantor nobody can place is not a guarantor, so how the applicant
  // knows them and where they live are part of the reference, not extras.
  relationship: z.string({ required_error: "Say how you know each guarantor.", invalid_type_error: "Say how you know each guarantor." }).trim().min(2, "Say how you know each guarantor.").max(120, tooLong("How you know a guarantor", 120)),
  guarantorType: z.enum(["Family", "Independent"], {
    errorMap: () => ({ message: "Say whether each guarantor is family or independent." })
  }),
  phone: z.string({ required_error: "Enter a phone number for each guarantor.", invalid_type_error: "Enter a phone number for each guarantor." }).trim().min(7, "Enter a phone number for each guarantor.").max(40, tooLong("A guarantor's phone number", 40)),
  whatsappPhone: z.string().trim().max(40, tooLong("A guarantor's WhatsApp number", 40)).optional(),
  email: z.string().trim().max(160, tooLong("A guarantor's email", 160)).optional(),
  address: z.string({ required_error: "Enter each guarantor's address.", invalid_type_error: "Enter each guarantor's address." }).trim().min(4, "Enter each guarantor's address.").max(500, tooLong("A guarantor's address", 500)),
  occupation: z.string().trim().max(160, tooLong("A guarantor's occupation", 160)).optional(),
  workplace: z.string().trim().max(160, tooLong("A guarantor's workplace", 160)).optional(),
  yearsKnown: z.string().trim().max(60, tooLong("How long you have known a guarantor", 60)).optional(),
  referenceStatement: z.string().trim().max(1000, tooLong("A guarantor's reference note", 1000)).optional(),
  idDocumentPath: z.string().trim().max(500).optional(),
  photoPath: z.string().trim().max(500).optional()
});

export const SubmitSchema = z.object({
  fullName: z.string({ required_error: "Enter your full name as written on your ID.", invalid_type_error: "Enter your full name as written on your ID." }).trim().min(2, "Enter your full name as written on your ID.").max(160, tooLong("Your name", 160)),
  phone: z.string({ required_error: "Enter a phone number we can reach you on.", invalid_type_error: "Enter a phone number we can reach you on." }).trim().min(7, "Enter a phone number we can reach you on.").max(40, tooLong("Your phone number", 40)),
  whatsappPhone: z.string().trim().max(40, tooLong("Your WhatsApp number", 40)).optional(),
  email: z.string().trim().max(160, tooLong("Your email", 160)).optional(),
  dateOfBirth: z.string({ required_error: "Enter your date of birth.", invalid_type_error: "Enter your date of birth." }).trim().min(4, "Enter your date of birth.").max(20, "That date of birth does not look right - use the date picker."),
  gender: z.enum(["Male", "Female", "Prefer not to say"]).optional(),
  state: z.string({ required_error: "Choose your state.", invalid_type_error: "Choose your state." }).trim().min(2, "Choose your state.").max(80, tooLong("Your state", 80)),
  city: z.string({ required_error: "Enter your city or town.", invalid_type_error: "Enter your city or town." }).trim().min(2, "Enter your city or town.").max(80, tooLong("Your city or town", 80)),
  residentialAddress: z.string({ required_error: "Enter your home address.", invalid_type_error: "Enter your home address." }).trim().min(4, "Enter your home address.").max(500, tooLong("Your home address", 500)),
  emergencyContactName: z.string({ required_error: "Enter an emergency contact name.", invalid_type_error: "Enter an emergency contact name." }).trim().min(2, "Enter an emergency contact name.").max(160, tooLong("Your emergency contact name", 160)),
  emergencyContactPhone: z.string({ required_error: "Enter an emergency contact phone number.", invalid_type_error: "Enter an emergency contact phone number." }).trim().min(7, "Enter an emergency contact phone number.").max(40, tooLong("Your emergency contact number", 40)),
  idType: z.enum(["NIN", "Driver's Licence", "Voter's Card", "International Passport"], {
    errorMap: () => ({ message: "Choose which ID you are using." })
  }),
  idNumber: z.string({ required_error: "Enter your ID number.", invalid_type_error: "Enter your ID number." }).trim().min(4, "Enter your ID number.").max(60, tooLong("Your ID number", 60)),
  idFrontPath: z.string({ required_error: "Upload a photo of your ID.", invalid_type_error: "Upload a photo of your ID." }).trim().min(4, "Upload a photo of your ID.").max(500),
  idBackPath: z.string().trim().max(500).optional(),
  selfiePath: z.string({ required_error: "Upload a selfie holding your ID.", invalid_type_error: "Upload a selfie holding your ID." }).trim().min(4, "Upload a selfie holding your ID.").max(500),
  proofOfAddressPath: z.string().trim().max(500).optional(),
  transportMethod: z.enum([
    "Motorcycle", "Car", "Public transport", "Bicycle", "Walking", "Hired dispatch", "Other"
  ], { errorMap: () => ({ message: "Say how you move around." }) }),
  vehicleModel: z.string().trim().max(120, tooLong("Your vehicle model", 120)).optional(),
  vehiclePlate: z.string().trim().max(40, tooLong("Your plate number", 40)).optional(),
  serviceAreas: z.array(z.string().trim().max(80, tooLong("An area name", 80)), { required_error: "Say which areas you can deliver to.", invalid_type_error: "Say which areas you can deliver to." })
    .min(1, "Say which areas you can deliver to.")
    .max(20, "You have listed too many delivery areas. Keep the 20 you cover best and remove the rest."),
  bankName: z.string({ required_error: "Enter your bank.", invalid_type_error: "Enter your bank." }).trim().min(2, "Enter your bank.").max(120, tooLong("Your bank name", 120)),
  bankAccountNumber: z.string({ required_error: "Enter your account number.", invalid_type_error: "Enter your account number." }).trim().min(6, "Enter your account number.").max(40, tooLong("Your account number", 40)),
  bankAccountName: z.string({ required_error: "Enter your account name.", invalid_type_error: "Enter your account name." }).trim().min(2, "Enter your account name.").max(160, tooLong("Your account name", 160)),
  guarantors: z.array(GuarantorSchema, { required_error: "Two guarantors are required.", invalid_type_error: "Two guarantors are required." }).min(2, "Two guarantors are required.").max(4, "Only two guarantors are needed - please remove the extra ones."),
  consent: z.literal(true, { errorMap: () => ({ message: "Please confirm the details are true before submitting." }) })
}).superRefine((value, ctx) => {
  // Two relatives vouching for each other is not independent verification, and
  // the reviewer's approval check refuses the pair anyway - so refuse it at the
  // door rather than letting someone wait on an application that cannot pass.
  if (value.guarantors.every((g) => g.guarantorType === "Family")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["guarantors"],
      message: "One guarantor must not be family - an employer, landlord, colleague or community leader."
    });
  }
  const digits = (phone: string) => phone.replace(/\D/g, "");
  const numbers = value.guarantors.map((g) => digits(g.phone)).filter(Boolean);
  if (new Set(numbers).size !== numbers.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["guarantors"],
      message: "Your guarantors must be two different people with two different phone numbers."
    });
  }
  // A guarantor who is really the applicant proves nothing.
  if (numbers.includes(digits(value.phone))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["guarantors"],
      message: "A guarantor cannot be you. Please give someone else's number."
    });
  }
  if (["Motorcycle", "Car"].includes(value.transportMethod) && !value.vehiclePlate?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["vehiclePlate"],
      message: "Enter the plate number of the vehicle you deliver with."
    });
  }
});
