import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  text: z.string().min(1,"Выберите непустой текст.").max(20000,"Выберите фрагмент короче 20 000 знаков."),
  instruction: z.string().trim().min(1,"Напишите задачу для ИИ.").max(1500,"Сократите задачу до 1 500 знаков."),
  context: z.string().max(200).optional()
});
export type InputType = z.infer<typeof schema>;
export type OutputType = {text: string};
export const postRewrite = async (body: InputType,init?: RequestInit): Promise<OutputType> => {
  if(import.meta.env.MODE === "github-pages")
    throw Object.assign(new Error("ИИ ещё не подключён. Текст и графики можно редактировать вручную."),{code:"AI_NOT_CONFIGURED",status:503});
  const input = schema.safeParse(body);
  if(!input.success) throw new Error(input.error.issues[0]?.message || "Проверьте текст и задачу.");
  let response: Response;
  try {
    response=await fetch("/_api/rewrite", {
      ...init,method:"POST",headers:{"Content-Type":"application/json",...init?.headers},
      body:superjson.stringify(input.data)
    });
  } catch { throw new Error("Нет связи с ИИ. Проверьте подключение и повторите запрос."); }
  let result: OutputType & {error?:string;code?:string};
  try {result=superjson.parse(await response.text());}
  catch {throw new Error("ИИ временно недоступен. Попробуйте позже.");}
  if (!response.ok) throw Object.assign(new Error(result.error || "ИИ временно недоступен."),{code:result.code,status:response.status});
  return result;
};
